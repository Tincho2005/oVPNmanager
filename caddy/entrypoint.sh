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
