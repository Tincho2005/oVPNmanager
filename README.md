# oVPNmanager

Una interfaz web moderna, ligera y auto-contenida (sin bases de datos externas) para administrar usuarios, conexiones y estadísticas en servidores OpenVPN instalados mediante el script de **Nyr** (`openvpn-install.sh`) en sistemas Linux.

Diseñado con una estética de alta fidelidad tipo *glassmorphic dark-theme* y telemetría de ancho de banda en tiempo real.

## Características

- 🔐 **Autenticación Segura**: Login mediante contraseña con almacenamiento de sesión basado en JWT y cookies `HttpOnly`.
- 📊 **Panel de Telemetría**: Indicador de estado del servicio OpenVPN, conexiones activas, consumo de CPU y memoria RAM.
- 📈 **Gráfico de Tráfico en Tiempo Real**: Monitoreo dinámico del ancho de banda de red (interfaz virtual `tun0` o principal) mediante Chart.js.
- 👥 **Gestión de Clientes (Alta/Baja)**:
  - Crear usuarios de OpenVPN sin contraseña (non-interactive) a través del script de Nyr.
  - Revocar acceso a usuarios instantáneamente e invalidar sus certificados en Easy-RSA actualizando las listas de revocación (CRL) del servidor.
- 📥 **Descarga de Perfiles**: Descarga directa de archivos de configuración `.ovpn` listos para ser importados en dispositivos clientes.

---

## Requisitos de Sistema

### Opción A: Despliegue con Docker (Recomendado)
1. Servidor Linux con **Docker Engine** y **Docker Compose** instalados.
2. OpenVPN y Easy-RSA instalados en el host (vía `openvpn-install.sh` o manualmente).
3. El directorio `/etc/openvpn` del host debe ser accesible para lectura/escritura desde el contenedor.

### Opción B: Despliegue Nativo (sin Docker)
1. Servidor Linux con **OpenVPN** y certificados administrados por **Easy-RSA** (instalado de forma estándar mediante el script de Nyr).
2. **Node.js** (versión 16 o superior) instalado en el servidor.
3. El servidor web requiere **privilegios de root** (o permisos específicos de sudo) para poder interactuar con los logs de OpenVPN (`/var/log/openvpn/openvpn-status.log`), leer el índice de Easy-RSA y ejecutar comandos de revocación en `/etc/openvpn/easy-rsa/`.

---

## Estructura del Proyecto

```
oVPNmanager/
├── config.js                # Carga y gestiona las variables de entorno
├── package.json             # Dependencias y scripts de Node.js
├── server.js                # Servidor API Express y backend de telemetría
├── vpn-ops.sh               # Script bash puente para operaciones de OpenVPN
├── Dockerfile               # Imagen Docker para el servidor Node.js
├── docker-compose.yml       # Orquestación de servicios (ovpnmanager + caddy)
├── Caddyfile                # Configuración del proxy inverso HTTPS
├── .dockerignore            # Exclusiones para construcción Docker
├── caddy/
│   ├── Dockerfile           # Imagen Caddy custom con openssl
│   └── entrypoint.sh        # Entrypoint que genera/renueva certificado TLS autofirmado
├── .github/
│   └── workflows/
│       └── deploy.yml       # GitHub Actions para despliegue automático (self-hosted runner)
└── public/                  # Interfaz gráfica (Frontend SPA)
    ├── index.html           # Estructura del Dashboard y login
    ├── style.css            # Diseño responsivo y Glassmorphism
    └── app.js               # Controladores de red, Chart.js y actualizaciones
```

---

## Instalación y Configuración

### Opción 1: Docker Compose (Recomendado)

#### Prerrequisitos
- Docker Engine y Docker Compose instalados en el host.
- OpenVPN y Easy-RSA ya configurados en el host.
- Acceso root al host.

#### Pasos

1. **Clonar el repositorio** en el servidor (directorio de despliegue):

```bash
sudo mkdir -p /opt/ovpnmanager
sudo chown $USER:$USER /opt/ovpnmanager
git clone https://github.com/<tu-usuario>/ovpnmanager.git /opt/ovpnmanager
cd /opt/ovpnmanager
```

2. **Crear archivo `.env`** (opcional pero recomendado para producción):

```bash
nano .env
```

```env
ADMIN_PASSWORD=mi_super_contraseña_123
JWT_SECRET=clave_secreta_para_ovpn_manager_segura_a1b2c3d4
SERVER_PUBLIC_IP=<IP_PUBLICA_DEL_SERVIDOR>
```

> **Nota**: si no se define `.env`, la aplicación utiliza valores hardcodeados por defecto (`admin123`, `ovpn-manager-jwt-secret-key-change-me-123456789`).

3. **Levantar los servicios** con Docker Compose:

```bash
docker compose up -d --build
```

Esto construye dos imágenes:
- `ovpnmanager`: servidor Node.js con `bash`, `curl`, `wget` e `iproute2` (dependencias de `vpn-ops.sh`).
- `caddy`: proxy inverso con TLS autofirmado, genera un certificado RSA-4096 válido por 20 años almacenado en el volumen `ovpn-ssl-certs`.

4. **Verificar el despliegue**:

```bash
# Ver estado de los contenedores
docker compose ps

# Ver logs en tiempo real
docker compose logs -f

# Obtener IP interna del contenedor Caddy para acceder
CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker ps -q --filter "name=caddy"))
echo "Acceder a: https://$CONTAINER_IP:8843"
```

> **Certificado autofirmado**: el navegador mostrará una advertencia de seguridad. Acepta la excepción para acceder al panel.

---

#### Despliegue Automático con GitHub Actions (Self-Hosted Runner)

Para actualizaciones automáticas al hacer push a `main`:

1. Configurar los secretos en GitHub (`Settings → Secrets and variables → Actions → Repository secrets`):
   - `ADMIN_PASSWORD`
   - `JWT_SECRET`
   - `SERVER_PUBLIC_IP`

2. Instalar un **self-hosted runner** en el servidor host:

```bash
mkdir -p /opt/github-runner && cd /opt/github-runner
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/<tu-usuario>/<tu-repo> --token <TOKEN>
sudo ./svc.sh install && sudo ./svc.sh start
```

3. Cada push a `main` ejecutará automáticamente `docker compose up -d --build` en el host.

#### Persistencia de datos

| Recurso | Volumen / Montaje | Persistencia |
|---------|-------------------|--------------|
| Certificados TLS (`ovpn-ssl-certs`) | Named volume Docker | Sobrevive a `docker compose down`; se pierde con `docker compose down -v` |
| PKI y configuraciones OpenVPN | Bind mount `/etc/openvpn` del host | Persistente en el host, independiente de Docker |

> ⚠️ El bind mount `/etc/openvpn:/etc/openvpn` es **read-write** (no `:ro`) porque `vpn-ops.sh` escribe CRLs y certificados durante la emisión, revocación y purge.

---

### Opción 2: Despliegue Nativo (sin Docker)

#### 1. Clonar o copiar el proyecto al servidor Linux
Ubica la carpeta del proyecto en el servidor, por ejemplo en `/opt/ovpnmanager` o en el home del administrador:

```bash
sudo cp -r oVPNmanager /opt/ovpnmanager
cd /opt/ovpnmanager
```

#### 2. Instalar dependencias de Node.js
Ejecuta la instalación de dependencias requeridas (Express, Cookie Parser, JsonWebToken, Dotenv):

```bash
npm install
```

#### 3. Hacer ejecutable el script de operaciones de red
Asegúrate de otorgar permisos de ejecución a `vpn-ops.sh`:

```bash
chmod +x vpn-ops.sh
```

#### 4. Crear archivo de configuración `.env`
Crea un archivo `.env` en la raíz del proyecto para definir las credenciales y las rutas personalizadas de tu servidor:

```bash
nano .env
```

Agrega y modifica las siguientes variables según sea tu caso:

```env
# Puerto del servicio web
PORT=3000

# Contraseña para iniciar sesión en la web (¡CAMBIA ESTO!)
ADMIN_PASSWORD=mi_super_contraseña_123

# Clave secreta para firmar tokens JWT (¡CAMBIA ESTO POR ALGO LARGO!)
JWT_SECRET=clave_secreta_para_ovpn_manager_segura_a1b2c3d4

# --- Rutas de OpenVPN ---
# Ruta al log de estado de conexiones
OPENVPN_STATUS_LOG=/var/log/openvpn/openvpn-status.log

# Ruta al índice de certificados de Easy-RSA
EASYRSA_INDEX=/etc/openvpn/easy-rsa/pki/index.txt

# Directorio donde se guardan los archivos .ovpn de clientes creados
CLIENTS_DIR=/root

# Ruta al instalador de Nyr (usado para la creación de usuarios)
OPENVPN_INSTALL_SCRIPT=/root/openvpn-install.sh

# Interfaz de red a monitorear en el gráfico de ancho de banda
# 'tun0' es el predeterminado para el túnel OpenVPN
MONITOR_INTERFACE=tun0
```

---

## Despliegue en Producción (Despliegue Nativo)

Para producción sin Docker, se recomienda ejecutar la aplicación como un servicio del sistema mediante **systemd**. Esto garantiza que la web se inicie automáticamente tras reiniciar el servidor y corra de forma segura en segundo plano con privilegios adecuados.

### 1. Crear el archivo del servicio
Crea el archivo de configuración del servicio systemd:

```bash
sudo nano /etc/systemd/system/ovpnmanager.service
```

### 2. Pegar la configuración del servicio
Pega el siguiente bloque en el archivo, ajustando las rutas de `/opt/ovpnmanager` si utilizaste otra ubicación:

```ini
[Unit]
Description=oVPNmanager - OpenVPN Dashboard Web Service
After=network.target openvpn.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ovpnmanager
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=ovpnmanager

[Install]
WantedBy=multi-user.target
```

> **Nota sobre seguridad**: La aplicación debe correr como `User=root` para leer logs protegidos y regenerar certificados Easy-RSA en `/etc/openvpn`. Se recomienda no exponer el puerto de la aplicación directamente a internet; es preferible usar un proxy inverso como Nginx con SSL (Let's Encrypt) y restringir el acceso del puerto mediante cortafuegos (ufw/iptables) o VPN.

### 3. Iniciar e habilitar el servicio
Ejecuta los siguientes comandos para recargar el daemon del sistema, iniciar la web y activarla en el arranque:

```bash
sudo systemctl daemon-reload
sudo systemctl start ovpnmanager
sudo systemctl enable ovpnmanager
```

### 4. Monitorear logs del servicio
Puedes comprobar que la aplicación está corriendo y revisar el log de accesos o errores con:

```bash
sudo systemctl status ovpnmanager
# O para ver logs en tiempo real:
sudo journalctl -u ovpnmanager -f
```

¡Listo! Abre tu navegador favorito y accede a `http://IP_DE_TU_SERVIDOR:3000` (o el puerto configurado) e inicia sesión con la contraseña establecida en tu `.env`.

---

## Comandos Útiles (Docker)

| Acción | Comando |
|--------|---------|
| Ver logs en tiempo real | `docker compose logs -f` |
| Reiniciar servicios | `docker compose restart` |
| Reconstruir imágenes | `docker compose build --no-cache` |
| Detener servicios | `docker compose down` |
| Detener y eliminar volúmenes | `docker compose down -v` |
| Ver estado | `docker compose ps` |
| Ver IP del contenedor Caddy | `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <caddy_container>` |
| Test manual API | `curl -sk https://<IP_CADDY>:8843/api/auth/session` |
