# Plan de Dockerización con Caddy y GitHub Actions (v3)

## Cambios clave respecto al plan anterior
- **Node.js**: usa `node:24-alpine` en modo builder + runtime.
- **Proxy inverso**: Caddy sirve HTTPS en `8843` con certificado autofirmado; Node.js solo expone HTTP interno en `3000`.
- **Certificado**: almacenado en un named volume `ovpn-ssl-certs`, generado/validado en el entrypoint de Caddy antes de arrancar.
- **Despliegue**: mediante **self-hosted GitHub Actions runner** instalado en la máquina host. El workflow ejecuta comandos Docker directamente en el host, sin SSH.
- **Autenticación**: copia espejo de la actual. Contraseña y JWT secret hardcodeados como defaults. **No se requiere `.env`**.
- **Red**: `ovpnmanager` escucha en `0.0.0.0:3000` (interno). Caddy escucha en `0.0.0.0:8843` (interno). No se publican puertos al exterior.

---

## 1. Estructura de archivos nueva/modificada

### `Dockerfile` (Node.js)
```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:24-alpine
RUN apk add --no-cache bash
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### `caddy/Dockerfile`
```dockerfile
FROM caddy:alpine
RUN apk add --no-cache openssl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### `caddy/entrypoint.sh`
```bash
#!/bin/sh
set -e

CERT_DIR="/certs"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
DAYS_VALID=7300

check_cert() {
  if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    return 1
  fi
  if ! openssl x509 -checkend 0 -noout -in "$CERT_FILE" 2>/dev/null; then
    return 1
  fi
  CERT_MOD=$(openssl x509 -noout -modulus -in "$CERT_FILE" 2>/dev/null | openssl md5)
  KEY_MOD=$(openssl rsa -noout -modulus -in "$KEY_FILE" 2>/dev/null | openssl md5)
  if [ "$CERT_MOD" != "$KEY_MOD" ]; then
    return 1
  fi
  return 0
}

if ! check_cert; then
  echo "Generando nuevo certificado autofirmado (${DAYS_VALID} días)..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days $DAYS_VALID \
    -subj "/CN=ovpnmanager"
  echo "Certificado generado exitosamente."
else
  echo "Certificado existente válido. No se requiere regeneración."
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
```

### `Caddyfile`
```caddyfile
:8843 {
  tls /certs/fullchain.pem /certs/privkey.pem {
    protocols tls1.2 tls1.3
  }
  reverse_proxy ovpnmanager:3000 {
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-For {remote_host}
  }
}
```

### `docker-compose.yml`
```yaml
services:
  ovpnmanager:
    build: .
    volumes:
      - /etc/openvpn:/etc/openvpn:ro
    environment:
      - PORT=3000
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}
      - JWT_SECRET=${JWT_SECRET:-ovpn-manager-jwt-secret-key-change-me-123456789}
      - SERVER_PUBLIC_IP=${SERVER_PUBLIC_IP:-}
    restart: unless-stopped

  caddy:
    build: ./caddy
    volumes:
      - ovpn-ssl-certs:/certs
    depends_on:
      - ovpnmanager
    restart: unless-stopped

volumes:
  ovpn-ssl-certs:
```

> **Nota sobre red/puertos**: No se declara `ports` en `docker-compose.yml`. Los contenedores se comunican internamente. El acceso desde el host se realiza por IP interna del contenedor (ej. `docker exec` o desde otra red), cumpliendo el requisito de no exponer a internet.

### Modificar `config.js`
Cambiar puerto por defecto a `3000` (interno detrás de Caddy):
```js
port: process.env.PORT || 3000,
```

Mantener los defaults hardcodeados (copia espejo de autenticación actual):
```js
adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
jwtSecret: process.env.JWT_SECRET || 'ovpn-manager-jwt-secret-key-change-me-123456789',
```

### `.dockerignore`
```
node_modules
npm-debug.log
.git
.gitignore
README.md
.env
.nyc_output
coverage
.kilo
```

### `.github/workflows/deploy.yml`
```yaml
name: Deploy oVPNmanager
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy con Docker Compose
        run: |
          set -e
          
          # Asegurar que Docker Compose esté disponible
          if ! command -v docker &> /dev/null; then
            echo "Docker no está instalado. Instalando..."
            curl -fsSL https://get.docker.com | sh
          fi
          
          if ! docker compose version &> /dev/null; then
            echo "Docker Compose no está instalado. Instalando..."
            curl -fsSL https://get.docker.com | sh
          fi
          
          # Directorio de despliegue (debe coincidir con donde está clonado el repo)
          DEPLOY_DIR="${{ github.workspace }}"
          
          # Generar archivo .env desde secretos si no existe
          if [ ! -f .env ]; then
            cat > .env << EOF
ADMIN_PASSWORD=${{ secrets.ADMIN_PASSWORD }}
JWT_SECRET=${{ secrets.JWT_SECRET }}
SERVER_PUBLIC_IP=${{ secrets.SERVER_PUBLIC_IP }}
EOF
          fi
          
          # Rebuild y levantar servicios
          docker compose up -d --build
          
          # Esperar a que Caddy genere/verifique cert y levante
          sleep 15
          
          # Healthcheck final (acceso interno al contenedor)
          CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker ps -q --filter "name=caddy") 2>/dev/null || echo "")
          if [ -n "$CONTAINER_IP" ]; then
            curl -sk https://$CONTAINER_IP:8843/api/auth/session > /dev/null 2>&1 && echo "Despliegue exitoso" || (echo "Fallo en healthcheck" && docker compose logs --tail=100 && exit 1)
          else
            echo "No se pudo obtener IP del contenedor Caddy"
            docker compose logs --tail=100
            exit 1
          fi
```

---

## 2. Flujo de ejecución en cada push a main

1. GitHub Actions detecta el push a `main` y ejecuta el job en el **self-hosted runner** (máquina host).
2. El runner ejecuta los comandos directamente en el host:
   - Verifica/instala Docker y Docker Compose si faltan.
   - Hace `git checkout` del código (ya está en el workspace del runner).
   - Genera `.env` con secretos de GitHub si no existe.
   - Ejecuta `docker compose up -d --build`:
     - Construye la imagen Node 24 Alpine.
     - Construye la imagen Caddy custom con entrypoint.
     - Levanta `ovpnmanager` (HTTP en `3000`, interno) y `caddy` (HTTPS en `8843`, interno).
3. El entrypoint de Caddy verifica el certificado en el volumen `ovpn-ssl-certs`:
   - Si falta, está corrupto o expirado, genera uno nuevo RSA-4096 con 20 años de validez.
   - Si es válido, lo reutiliza.
4. Caddy arranca con TLS en `8843` y reverse proxy a `ovpnmanager:3000`.
5. Healthcheck vía `curl` a la IP interna del contenedor Caddy.

---

## 3. Variables de entorno y secretos de GitHub

### Secretos del repositorio (GitHub Settings → Secrets)
- `ADMIN_PASSWORD`: contraseña del panel web (fallback: `admin123`).
- `JWT_SECRET`: secreto para firmar tokens JWT (fallback: `ovpn-manager-jwt-secret-key-change-me-123456789`).
- `SERVER_PUBLIC_IP`: IP pública o hostname del servidor VPN.

### Variables locales en el host (`.env` en el directorio del runner)
Generadas automáticamente por el workflow desde los secretos de GitHub. Si no se configuran secretos, se usan los valores hardcodeados en `config.js`.

---

## 4. Configuración del Self-Hosted Runner

### Instalación en el host
1. Ir a GitHub → Settings → Actions → Runners → New self-hosted runner.
2. Seleccionar la arquitectura del host (Linux x64, ARM, etc.).
3. Ejecutar los comandos de instalación en el host:
   ```bash
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-linux-x64-2.321.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
   tar xzf ./actions-runner-linux-x64-2.321.0.tar.gz
   ./config.sh --url https://github.com/<org>/<repo> --token <TOKEN>
   ./run.sh
   ```
4. Configurar el runner como servicio (`sudo ./svc.sh install && sudo ./svc.sh start`).

### Configuración del repositorio
- En `.github/workflows/deploy.yml` usar `runs-on: self-hosted`.
- El runner debe tener acceso a Docker (pertenecer al grupo `docker` o ejecutar con sudo).
- El directorio de trabajo del runner debe coincidir con el directorio del proyecto.

---

## 5. Consideraciones

- **Sin SSH**: el workflow ejecuta comandos directamente en el host, sin necesidad de claves SSH ni configuración de acceso remoto.
- **Sin `.env` obligatorio**: el contenedor funciona con los defaults hardcodeados. El `.env` es opcional y solo se crea si hay secretos configurados en GitHub.
- **Red sin publicación de puertos**: los contenedores se comunican internamente; no hay mapeo `HOST:CONTAINER`. El acceso desde el host requiere inspeccionar la IP del contenedor o usar `docker exec`.
- **Bind mount `/etc/openvpn`**: la app lee Easy-RSA, configuraciones de OpenVPN y status logs directamente del host. El flag `:ro` es de seguridad; si en algún momento se necesita escritura, cambiarlo a read-write.
- **Persistencia del cert**: al estar en un named volume, sobrevive a `docker compose down` y actualizaciones. Solo se pierde con `docker compose down -v`.
- **Permisos**: el usuario que ejecuta el runner necesita permisos para ejecutar Docker (grupo `docker` o sudo).

---

## 6. Instructivo de preparación y ejecución (0 a 100%)

### Sistemas operativos soportados
- **Linux x86_64/arm64** (Ubuntu 20.04+, Debian 11+, CentOS 8/Rocky Linux 8+, Fedora 36+)
- **Prerequisitos del sistema operativo**:
  - Kernel 4.0+ con soporte para contenedores
  - Acceso root o sudo es requerido para instalar Docker y configurar el runner
  - openvpn y easy-rsa instalados en el host (mediante Nyr's openvpn-install.sh o manualmente)

### Programas necesarios y su instalación

| Programa | Propósito | Instalación |
|----------|-----------|-------------|
| Docker Engine | Runtime de contenedores | `curl -fsSL https://get.docker.com | sh` o paquete OS-native |
| Docker Compose (plugin) | Orquestación multi-contenedor | Incluido con `get.docker.com` (como `docker compose`) |
| Git | Clonar repositorio y versionado | `apt install git` / `dnf install git` / `yum install git` |
| GitHub Self-Hosted Runner | Ejecutar workflows localmente | Ver sección 7 |

#### Instalación de Docker (ejemplos por distro)
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin

# Rocky Linux/CentOS/Fedora
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker

# Añadir usuario al grupo docker
sudo usermod -aG docker $USER
# Cerrar sesión y volver a entrar para aplicar el grupo
```

---

### Pasos de implementación (0 a 100%)

#### PASO 0: Pre-requisitos del host
1. Instalar OpenVPN y configurar Easy-RSA (ej. `curl -O https://raw.githubusercontent.com/Nyr/openvpn-install/master/openvpn-install.sh && sudo bash openvpn-install.sh`)
2. Verificar que `/etc/openvpn/server/easy-rsa/` exista y esté inicializado
3. Verificar que el servidor OpenVPN esté corriendo: `systemctl status openvpn-server@server.service`

#### PASO 1: Crear directorio del proyecto
```bash
sudo mkdir -p /opt/ovpnmanager
sudo chown $USER:$USER /opt/ovpnmanager
git clone https://github.com/<usuario>/ovpnmanager.git /opt/ovpnmanager
cd /opt/ovpnmanager
```

#### PASO 2: Modificar `config.js`
Cambiar el puerto a 3000 (el Caddy proxy escuchará en 8843):
```js
port: process.env.PORT || 3000,
```

#### PASO 3: Crear archivos de Dockerización
Crear los siguientes archivos en el directorio del proyecto:

**`Dockerfile`**
```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:24-alpine
RUN apk add --no-cache bash
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**`caddy/Dockerfile`**
```dockerfile
FROM caddy:alpine
RUN apk add --no-cache openssl
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

**`caddy/entrypoint.sh`**
```bash
#!/bin/sh
set -e

CERT_DIR="/certs"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"
DAYS_VALID=7300

check_cert() {
  if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    return 1
  fi
  if ! openssl x509 -checkend 0 -noout -in "$CERT_FILE" 2>/dev/null; then
    return 1
  fi
  CERT_MOD=$(openssl x509 -noout -modulus -in "$CERT_FILE" 2>/dev/null | openssl md5)
  KEY_MOD=$(openssl rsa -noout -modulus -in "$KEY_FILE" 2>/dev/null | openssl md5)
  if [ "$CERT_MOD" != "$KEY_MOD" ]; then
    return 1
  fi
  return 0
}

if ! check_cert; then
  echo "Generando nuevo certificado autofirmado (${DAYS_VALID} días)..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:4096 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days $DAYS_VALID \
    -subj "/CN=ovpnmanager"
  echo "Certificado generado exitosamente."
else
  echo "Certificado existente válido. No se requiere regeneración."
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
```

**`Caddyfile`**
```caddyfile
:8843 {
  tls /certs/fullchain.pem /certs/privkey.pem {
    protocols tls1.2 tls1.3
  }
  reverse_proxy ovpnmanager:3000 {
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-For {remote_host}
  }
}
```

**`docker-compose.yml`**
```yaml
services:
  ovpnmanager:
    build: .
    volumes:
      - /etc/openvpn:/etc/openvpn:ro
    environment:
      - PORT=3000
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}
      - JWT_SECRET=${JWT_SECRET:-ovpn-manager-jwt-secret-key-change-me-123456789}
      - SERVER_PUBLIC_IP=${SERVER_PUBLIC_IP:-}
    restart: unless-stopped

  caddy:
    build: ./caddy
    volumes:
      - ovpn-ssl-certs:/certs
    depends_on:
      - ovpnmanager
    restart: unless-stopped

volumes:
  ovpn-ssl-certs:
```

**`.dockerignore`**
```
node_modules
npm-debug.log
.git
.gitignore
.env
.nyc_output
coverage
.kilo
```

**`.github/workflows/deploy.yml`**
```yaml
name: Deploy oVPNmanager
on:
  push:
    branches: [ main ]
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy con Docker Compose
        run: |
          set -e
          
          # Asegurar que Docker Compose esté disponible
          if ! command -v docker &> /dev/null; then
            echo "Docker no está instalado. Instalando..."
            curl -fsSL https://get.docker.com | sh
          fi
          
          if ! docker compose version &> /dev/null; then
            echo "Docker Compose no está instalado. Instalando..."
            curl -fsSL https://get.docker.com | sh
          fi
          
          # Generar archivo .env desde secretos si no existe
          if [ ! -f .env ]; then
            echo "ADMIN_PASSWORD=${{ secrets.ADMIN_PASSWORD }}" > .env
            echo "JWT_SECRET=${{ secrets.JWT_SECRET }}" >> .env
            echo "SERVER_PUBLIC_IP=${{ secrets.SERVER_PUBLIC_IP }}" >> .env
          fi
          
          # Rebuild y levantar servicios
          docker compose up -d --build
          
          # Esperar a que Caddy genere/verifique cert y levante
          sleep 15
          
          # Healthcheck final (acceso interno al contenedor)
          CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker ps -q --filter "name=caddy") 2>/dev/null || echo "")
          if [ -n "$CONTAINER_IP" ]; then
            curl -sk https://$CONTAINER_IP:8843/api/auth/session > /dev/null 2>&1 && echo "Despliegue exitoso" || (echo "Fallo en healthcheck" && docker compose logs --tail=100 && exit 1)
          else
            echo "No se pudo obtener IP del contenedor Caddy"
            docker compose logs --tail=100
            exit 1
          fi
```

#### PASO 4: Configurar GitHub
1. Ir a **Settings → Secrets and variables → Actions → Repository secrets**.
2. Añadir los siguientes secretos:
   - `ADMIN_PASSWORD`: (contraseña deseada para el panel)
   - `JWT_SECRET`: (secreto aleatorio fuerte)
   - `SERVER_PUBLIC_IP`: (IP pública del servidor VPN)
3. Commit y push a la rama `main`.

#### PASO 5: Instalar Self-Hosted Runner
```bash
# En el directorio del proyecto, crear runner
mkdir -p /opt/github-runner
cd /opt/github-runner

# Descargar (ejemplo x64, ver https://github.com/actions/runner/releases para versiones actualizadas)
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz

# Configurar (obtener token desde GitHub)
./config.sh --url https://github.com/<usuario>/ovpnmanager --token <TOKEN>

# Instalar como servicio
sudo ./svc.sh install
sudo ./svc.sh start
```

#### PASO 6: Verificar el despliegue
1. Push a `main` activa el workflow automáticamente.
2. Ver logs: `sudo journalctl -u actions.runner.<organizacion>-<repo>-<numero>.service -f`
3. Ver contenedores: `docker ps -a`
4. Ver IP del contenedor Caddy: `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <container_id>`
5. Acceder vía navegador a `https://<IP_DEL_CONTENEDOR>:8843` (certificado autofirmado, aceptar excepción de seguridad).

---

### Comandos útiles post-despliegue

| Acción | Comando |
|--------|---------|
| Ver logs en tiempo real | `docker compose logs -f` |
| Reiniciar servicios | `docker compose restart` |
| Reconstruir imágenes | `docker compose build --no-cache` |
| Detener servicios | `docker compose down` |
| Ver logs del runner | `sudo journalctl -u actions.runner.* -f` |
| Ver IP Caddy | `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <caddy_container>` |
| Test manual API | `curl -sk https://<IP_CADDY>:8843/api/auth/session` |

---

### Solución de problemas comunes

| Problema | Solución |
|----------|----------|
| Runner no se ejecuta | Verificar que `systemctl status actions.runner.*` esté activo. Añadir usuario al grupo `docker`. |
| `docker compose` no encontrado | Reiniciar sesión después de instalar, o usar `docker-compose` (versión 1). |
| Certificado no se genera | Ver logs: `docker compose logs caddy`. Verificar permisos del directorio `/certs`. |
| Acceso denegado a `/etc/openvpn` | El bind mount usa `:ro`. Para escribir CRL, cambiar a read-write y reiniciar contenedor. |
| Healthcheck falla | Esperar más tiempo. Verificar que OpenVPN esté corriendo en el host. |
