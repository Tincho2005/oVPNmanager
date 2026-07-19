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

- Servidor **Linux** (Ubuntu/Debian, Rocky/RHEL, Fedora, Alpine o derivados).
- Acceso **root** (sudo) en el host.
- OpenVPN y Easy-RSA instalados en el host (vía `openvpn-install.sh` o manualmente). El instalador funciona sin ellos, pero la gestión de clientes los requiere.
- El instalador **detecta e instala automáticamente** las dependencias que falten (Docker, Node.js, curl, wget, iproute2, etc.) según el modo elegido.

---

## Estructura del Proyecto

```
oVPNmanager/
├── config.js                # Carga y gestiona las variables de entorno
├── package.json             # Dependencias y scripts de Node.js
├── server.js                # Servidor API Express y backend de telemetría
├── vpn-ops.sh               # Script bash puente para operaciones de OpenVPN
├── install.sh               # Instalador interactivo (docker/nativo, auto-detecta deps)
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

El repositorio incluye un **instalador interactivo** (`install.sh`) que funciona en hosts Linux nuevos o existentes. Detecta las dependencias faltantes, pregunta si deseas instalar en **modo dockerizado** o **nativo**, y realiza la instalación completa automáticamente.

### Paso 1: Clonar el repositorio

En el servidor host, clona el proyecto en el directorio de despliegue (por ejemplo `/opt/ovpnmanager`):

```bash
sudo mkdir -p /opt/ovpnmanager
sudo chown $USER:$USER /opt/ovpnmanager
git clone https://github.com/<tu-usuario>/oVPNmanager.git /opt/ovpnmanager
cd /opt/ovpnmanager
```

### Paso 2: Ejecutar el instalador

```bash
sudo bash install.sh
```

El instalador:
1. Verifica que se ejecuta como **root**.
2. Detecta si **OpenVPN + Easy-RSA** ya están instalados en el host (y lo advierte si no).
3. Detecta el gestor de paquetes del host (apt, dnf, yum, apk, zypper).
4. Pregunta el **modo de instalación**:
   - `1) Dockerizado` — instala Docker si falta, construye y levanta los contenedores con Caddy (TLS autofirmado en `:8843`).
   - `2) Nativo` — instala Node.js y dependencias, crea el servicio **systemd**.
5. Genera el archivo `.env` preguntando la contraseña de admin, JWT secret (aleatorio si se omite) y la IP pública del servidor.

También puedes elegir el modo sin preguntas:
```bash
sudo bash install.sh --docker     # modo dockerizado
sudo bash install.sh --native     # modo nativo (systemd)
```

> **Nota**: si ya existe un archivo `.env`, el instalador lo respeta y no lo sobrescribe.

### Requisitos previos según el modo

| Modo | El host necesita | El instalador instala si falta |
|------|------------------|--------------------------------|
| Dockerizado | Acceso root, OpenVPN previo (recomendado) | Docker Engine + Compose plugin |
| Nativo | Acceso root, OpenVPN previo (recomendado) | Node.js ≥ 16, npm, curl, wget, iproute2, gawk, sed, openssl |

Si el host **no tiene OpenVPN**, el panel se instala igualmente, pero la creación y revocación de clientes no funcionará hasta instalarlo (p. ej. con `curl -O https://raw.githubusercontent.com/Nyr/openvpn-install/master/openvpn-install.sh && sudo bash openvpn-install.sh`).

---

## Modo Dockerizado (detalles)

### Arquitectura
- `ovpnmanager`: servidor Node.js (HTTP en `localhost:3000`), corre con `network_mode: host` y `pid: host` para detectar el estado de OpenVPN y escribir en `/etc/openvpn`.
- `caddy`: proxy inverso con TLS autofirmado RSA-4096 (válido 20 años) en `:8843`, certificado persistido en el volumen `ovpn-ssl-certs`.
- Bind mount `/etc/openvpn:/etc/openvpn:rw` (read-write obligatorio para emitir/revocar/purgar certificados).

### Comandos útiles
```bash
docker compose ps                 # estado de los servicios
docker compose logs -f            # logs en tiempo real
docker compose restart            # reiniciar servicios
docker compose build --no-cache   # reconstruir imágenes
docker compose down               # detener (conserva volúmenes)
docker compose down -v            # detener y eliminar volúmenes
curl -sk https://localhost:8843/api/auth/session   # healthcheck
```

> **Certificado autofirmado**: el navegador mostrará una advertencia de seguridad. Acéptala para acceder al panel.

### Despliegue Automático con GitHub Actions (Self-Hosted Runner)
Para actualizar automáticamente al hacer push a `main`:
1. Configura los secretos en GitHub (`Settings → Secrets and variables → Actions → Repository secrets`): `ADMIN_PASSWORD`, `JWT_SECRET`, `SERVER_PUBLIC_IP`.
2. Instala un **self-hosted runner** en el host:
```bash
mkdir -p /opt/github-runner && cd /opt/github-runner
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-linux-x64-2.321.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
./config.sh --url https://github.com/<tu-usuario>/oVPNmanager --token <TOKEN>
sudo ./svc.sh install && sudo ./svc.sh start
```
3. Cada push a `main` ejecuta `docker compose up -d --build` en el host.

---

## Modo Nativo (detalles)

El instalador crea `/etc/systemd/system/ovpnmanager.service` apuntando al `node` del host y cargando `.env` vía `EnvironmentFile`.

### Comandos útiles
```bash
sudo systemctl status ovpnmanager       # estado
sudo journalctl -u ovpnmanager -f        # logs en tiempo real
sudo systemctl restart ovpnmanager       # reiniciar
sudo systemctl enable ovpnmanager        # habilitar en el arranque
```

> **Nota de seguridad**: la app corre como `root` para leer logs y regenerar certificados en `/etc/openvpn`. No expongas el puerto `3000` directamente a internet; usa un proxy inverso con TLS y restringe con cortafuegos.

---

## Acceso al panel

- **Dockerizado**: `https://<IP_DEL_HOST>:8843`
- **Nativo**: `http://<IP_DEL_HOST>:3000`

Inicia sesión con la contraseña definida en `.env` (`ADMIN_PASSWORD`, por defecto `admin123`).
