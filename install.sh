#!/usr/bin/env bash
#
# oVPNmanager - Instalador interactivo
# Soporta modo DOCKERIZADO (Docker + Caddy) y NATIVO (Node.js + systemd).
# Detecta y ofrece instalar dependencias faltantes en el host Linux.
#
# Uso:
#   sudo bash install.sh
#   sudo bash install.sh --docker      (no interactivo: modo docker)
#   sudo bash install.sh --native      (no interactivo: modo nativo)
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------
BOLD="\033[1m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

info()  { echo -e "${CYAN}[INFO]${RESET} $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[AVISO]${RESET} $*"; }
err()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
die()   { err "$*"; exit 1; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    die "Este instalador debe ejecutarse como root (usa: sudo bash install.sh)"
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

detect_pkg_manager() {
  if command_exists apt-get; then echo "apt"
  elif command_exists dnf; then echo "dnf"
  elif command_exists yum; then echo "yum"
  elif command_exists apk; then echo "apk"
  elif command_exists zypper; then echo "zypper"
  else echo "unknown"
  fi
}

# ----------------------------------------------------------------------------
# Detección de OpenVPN / Easy-RSA en el host
# ----------------------------------------------------------------------------
openvpn_ready=false
if command_exists openvpn || systemctl list-units --type=service 2>/dev/null | grep -q "openvpn"; then
  if [[ -d /etc/openvpn/server/easy-rsa ]] || [[ -d /etc/openvpn/easy-rsa ]]; then
    openvpn_ready=true
  fi
fi

# ----------------------------------------------------------------------------
# Instalación de dependencias según el modo
# ----------------------------------------------------------------------------
install_docker() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    ok "Docker y Docker Compose ya están instalados."
    return
  fi
  warn "Docker no está disponible. Instalando Docker Engine + Compose plugin..."
  curl -fsSL https://get.docker.com | sh
  if command_exists systemctl; then
    systemctl enable --now docker 2>/dev/null || true
  fi
  ok "Docker instalado."
}

install_native_deps() {
  local pm
  pm="$(detect_pkg_manager)"
  info "Gestor de paquetes detectado: ${pm:-desconocido}"
  case "$pm" in
    apt)
      apt-get update -y
      apt-get install -y nodejs npm curl wget iproute2 gawk sed procps psmisc findutils openssl
      ;;
    dnf|yum)
      "$pm" install -y nodejs npm curl wget iproute2 gawk sed procps-ng psmisc findutils openssl
      ;;
    apk)
      apk add --no-cache nodejs npm curl wget iproute2 gawk sed procps psmisc findutils openssl
      ;;
    zypper)
      zypper install -y nodejs npm curl wget iproute2 gawk sed procps psmisc findutils openssl
      ;;
    *)
      warn "No se pudo detectar el gestor de paquetes. Instala manualmente: nodejs >= 16, npm, curl, wget, iproute2, gawk, sed, openssl."
      ;;
  esac
  if ! command_exists node || ! command_exists npm; then
    die "Node.js no pudo instalarse. Instálalo manualmente (https://nodejs.org) e intenta de nuevo."
  fi
  ok "Dependencias nativas instaladas (node $(node -v))."
}

# ----------------------------------------------------------------------------
# Configuración .env
# ----------------------------------------------------------------------------
configure_env() {
  local dir="$1"
  if [[ -f "$dir/.env" ]]; then
    ok "Ya existe .env en $dir. Se conserva."
    return
  fi
  echo
  info "Configuración de credenciales (deja en blanco para usar defaults seguros)."
  local admin_pass jwt_secret server_ip
  read -r -p "Contraseña de administrador [default: admin123]: " admin_pass
  read -r -p "JWT secret [deja en blanco para generar uno aleatorio]: " jwt_secret
  read -r -p "IP pública del servidor VPN (SERVER_PUBLIC_IP) [opcional]: " server_ip

  [[ -z "$jwt_secret" ]] && jwt_secret="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"

  {
    echo "ADMIN_PASSWORD=${admin_pass:-admin123}"
    echo "JWT_SECRET=${jwt_secret}"
    echo "SERVER_PUBLIC_IP=${server_ip:-}"
  } > "$dir/.env"

  chmod 600 "$dir/.env"
  ok "Archivo .env creado en $dir (permisos 600)."
}

# ----------------------------------------------------------------------------
# Modos de instalación
# ----------------------------------------------------------------------------
deploy_docker() {
  local dir="$1"
  info "Instalando en MODO DOCKERIZADO..."
  install_docker
  configure_env "$dir"
  cd "$dir"
  docker compose up -d --build
  sleep 5
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  ok "Despliegue dockerizado completado."
  warn "El panel usa un certificado TLS autofirmado. El navegador mostrará una advertencia; acéptala."
  echo -e "   Accede a: ${BOLD}https://${ip:-<IP_DEL_HOST>}:8843${RESET}"
  echo -e "   Healthcheck: ${BOLD}curl -sk https://localhost:8843/api/auth/session${RESET}"
}

deploy_native() {
  local dir="$1"
  info "Instalando en MODO NATIVO (Node.js + systemd)..."
  install_native_deps
  cd "$dir"
  chmod +x vpn-ops.sh
  npm install --omit=dev
  configure_env "$dir"

  local svc="/etc/systemd/system/ovpnmanager.service"
  cat > "$svc" <<EOF
[Unit]
Description=oVPNmanager - OpenVPN Dashboard Web Service
After=network.target openvpn.service

[Service]
Type=simple
User=root
WorkingDirectory=$dir
ExecStart=$(command -v node) $dir/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=ovpnmanager
EnvironmentFile=$dir/.env

[Install]
WantedBy=multi-user.target
EOF

  if command_exists systemctl; then
    systemctl daemon-reload
    systemctl enable --now ovpnmanager
    ok "Servicio systemd habilitado e iniciado."
  else
    warn "systemd no disponible. Inicia manualmente: node $dir/server.js"
  fi

  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  ok "Despliegue nativo completado."
  echo -e "   Accede a: ${BOLD}http://${ip:-<IP_DEL_HOST>}:3000${RESET}"
  echo -e "   Ver estado: ${BOLD}systemctl status ovpnmanager${RESET}"
}

# ----------------------------------------------------------------------------
# Flujo principal
# ----------------------------------------------------------------------------
main() {
  require_root

  # Determinar directorio del proyecto (donde está este script)
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  info "Directorio del proyecto: $SCRIPT_DIR"

  # ¿OpenVPN presente en el host?
  if [[ "$openvpn_ready" == true ]]; then
    ok "Se detectó OpenVPN + Easy-RSA en /etc/openvpn."
  else
    warn "NO se detectó OpenVPN/Easy-RSA instalado en el host."
    echo -e "   Puedes instalarlo con Nyr: ${BOLD}curl -O https://raw.githubusercontent.com/Nyr/openvpn-install/master/openvpn-install.sh && sudo bash openvpn-install.sh${RESET}"
    echo "   El panel funcionará, pero la creación/revocación de clientes requiere OpenVPN configurado."
  fi

  # Modo no interactivo por flags
  local MODE=""
  case "${1:-}" in
    --docker) MODE="docker" ;;
    --native) MODE="native" ;;
  esac

  if [[ -z "$MODE" ]]; then
    echo
    echo -e "${BOLD}Selecciona el modo de instalación:${RESET}"
    echo "  1) Dockerizado  (Docker + Caddy con TLS autofirmado en :8843)"
    echo "  2) Nativo       (Node.js + systemd, HTTP en :3000)"
    read -r -p "Opción [1/2]: " choice
    case "$choice" in
      1|docker|D|d) MODE="docker" ;;
      2|native|N|n)  MODE="native" ;;
      *) die "Opción inválida." ;;
    esac
  fi

  if [[ "$MODE" == "docker" ]]; then
    deploy_docker "$SCRIPT_DIR"
  else
    deploy_native "$SCRIPT_DIR"
  fi

  echo
  ok "Instalación finalizada."
}

main "$@"
