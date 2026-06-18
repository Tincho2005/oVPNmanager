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

1. Servidor Linux con **OpenVPN** y certificados administrados por **Easy-RSA** (instalado de forma estándar mediante el script de Nyr).
2. **Node.js** (versión 16 o superior) instalado en el servidor.
3. El servidor web requiere **privilegios de root** (o permisos específicos de sudo) para poder interactuar con los logs de OpenVPN (`/var/log/openvpn/openvpn-status.log`), leer el índice de Easy-RSA y ejecutar comandos de revocación en `/etc/openvpn/easy-rsa/`.

---

## Estructura del Proyecto

```
oVPNmanager/
├── config.js            # Carga y gestiona las variables de entorno
├── package.json         # Dependencias y scripts de Node.js
├── server.js            # Servidor API Express y backend de telemetría
├── vpn-ops.sh           # Script bash puente para operaciones de OpenVPN
└── public/              # Interfaz gráfica (Frontend SPA)
    ├── index.html       # Estructura del Dashboard y login
    ├── style.css        # Diseño responsivo y Glassmorphism
    └── app.js           # Controladores de red, Chart.js y actualizaciones
```

---

## Instalación y Configuración

### 1. Clonar o copiar el proyecto al servidor Linux
Ubica la carpeta del proyecto en el servidor, por ejemplo en `/opt/ovpnmanager` o en el home del administrador:

```bash
sudo cp -r oVPNmanager /opt/ovpnmanager
cd /opt/ovpnmanager
```

### 2. Instalar dependencias de Node.js
Ejecuta la instalación de dependencias requeridas (Express, Cookie Parser, JsonWebToken, Dotenv):

```bash
npm install
```

### 3. Hacer ejecutable el script de operaciones de red
Asegúrate de otorgar permisos de ejecución a `vpn-ops.sh`:

```bash
chmod +x vpn-ops.sh
```

### 4. Crear archivo de configuración `.env`
Crea un archivo `.env` en la raíz del proyecto para definir las credenciales y las rutas personalizadas de tu servidor:

```bash
nano .env
```

Agrega y modifica las siguientes variables según sea tu caso:

```env
# Puerto del servicio web
PORT=8080

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

## Despliegue en Producción (Recomendado)

Para producción, se recomienda ejecutar la aplicación como un servicio del sistema mediante **systemd**. Esto garantiza que la web se inicie automáticamente tras reiniciar el servidor y corra de forma segura en segundo plano con privilegios adecuados.

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

¡Listo! Abre tu navegador favorito y accede a `http://IP_DE_TU_SERVIDOR:8080` (o el puerto configurado) e inicia sesión con la contraseña establecida en tu `.env`.
