#!/bin/bash

# oVPNmanager helper script for managing OpenVPN clients.
# This script is called by the Node.js backend. It must run with root privileges.
#
# Replicates Nyr's openvpn-install.sh client creation logic directly via Easy-RSA,
# without calling the interactive installer which intentionally discards stdin.

COMMAND=$1
CLIENT_NAME=$2

# Load environment configuration if available (from backend environment)
CLIENTS_DIR="${CLIENTS_DIR:-/root}"

if [ -z "$COMMAND" ] || [ -z "$CLIENT_NAME" ]; then
    echo "Usage: $0 [add|profile|revoke|purge] [client_name]"
    exit 1
fi

# Sanitize client name: allow only alphanumeric, dashes, and underscores
if [[ ! "$CLIENT_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: Invalid client name. Use only letters, numbers, dashes, and underscores."
    exit 1
fi

# Detect Easy-RSA directory (Nyr places it inside /etc/openvpn/server/)
if [ -d "/etc/openvpn/server/easy-rsa" ]; then
    EASYRSA_DIR="/etc/openvpn/server/easy-rsa"
elif [ -d "/etc/openvpn/easy-rsa" ]; then
    EASYRSA_DIR="/etc/openvpn/easy-rsa"
else
    echo "Error: Easy-RSA directory not found. Is OpenVPN installed via Nyr's script?"
    exit 1
fi

# Detect OpenVPN server config directory (Nyr uses /etc/openvpn/server/)
if [ -f "/etc/openvpn/server/server.conf" ]; then
    OPENVPN_DIR="/etc/openvpn/server"
elif [ -f "/etc/openvpn/server.conf" ]; then
    OPENVPN_DIR="/etc/openvpn"
else
    OPENVPN_DIR="/etc/openvpn/server"
fi

SERVER_CONF="$OPENVPN_DIR/server.conf"

resolve_openvpn_path() {
    local raw_path="$1"
    raw_path="${raw_path%%#*}"
    raw_path="${raw_path%%;*}"
    raw_path=$(echo "$raw_path" | awk '{$1=$1; print}')
    raw_path="${raw_path%\"}"
    raw_path="${raw_path#\"}"
    raw_path="${raw_path%\'}"
    raw_path="${raw_path#\'}"

    if [ -z "$raw_path" ]; then
        return 1
    fi

    if [[ "$raw_path" = /* ]]; then
        echo "$raw_path"
    else
        echo "$OPENVPN_DIR/$raw_path"
    fi
}

case "$COMMAND" in
    add|profile)
        if [ "$COMMAND" = "add" ]; then
            echo "=== ADD CLIENT: $CLIENT_NAME ==="
        else
            echo "=== REGENERATE CLIENT PROFILE: $CLIENT_NAME ==="
        fi

        # Check if Easy-RSA is set up
        if [ ! -f "$EASYRSA_DIR/easyrsa" ]; then
            echo "Error: easyrsa binary not found in $EASYRSA_DIR"
            exit 1
        fi

        # Check if the PKI is initialized
        if [ ! -d "$EASYRSA_DIR/pki" ]; then
            echo "Error: Easy-RSA PKI not initialized at $EASYRSA_DIR/pki"
            exit 1
        fi

        if [ "$COMMAND" = "add" ]; then
            # Check if the client certificate already exists to avoid errors
            if [ -f "$EASYRSA_DIR/pki/issued/$CLIENT_NAME.crt" ]; then
                echo "Error: Certificate for '$CLIENT_NAME' already exists. Choose a different name."
                exit 1
            fi

            echo "Generating client certificate using Easy-RSA..."
            cd "$EASYRSA_DIR" || exit 1
            EASYRSA_CERT_EXPIRE=3650 ./easyrsa --batch build-client-full "$CLIENT_NAME" nopass 2>&1
            if [ $? -ne 0 ]; then
                echo "Error: Failed to generate client certificate."
                exit 1
            fi
            echo "Certificate generated successfully."
        else
            if [ ! -f "$EASYRSA_DIR/pki/issued/$CLIENT_NAME.crt" ] || [ ! -f "$EASYRSA_DIR/pki/private/$CLIENT_NAME.key" ]; then
                echo "Error: Certificate or private key for '$CLIENT_NAME' was not found."
                exit 1
            fi
        fi

        # ---- Detect server protocol and port from server.conf ----
        SERVER_PORT="1194"
        SERVER_PROTO="udp"
        if [ -f "$SERVER_CONF" ]; then
            PORT_LINE=$(grep -E "^port " "$SERVER_CONF" | head -1)
            [ -n "$PORT_LINE" ] && SERVER_PORT=$(echo "$PORT_LINE" | awk '{print $2}')

            PROTO_LINE=$(grep -E "^proto " "$SERVER_CONF" | head -1)
            if [ -n "$PROTO_LINE" ]; then
                SERVER_PROTO=$(echo "$PROTO_LINE" | awk '{print $2}')
                # Normalize: tcp6 -> tcp, udp6 -> udp
                SERVER_PROTO=$(echo "$SERVER_PROTO" | sed 's/6$//')
            fi
        fi

        CLIENT_PROTO="$SERVER_PROTO"
        if [[ "$SERVER_PROTO" == tcp* ]]; then
            CLIENT_PROTO="tcp-client"
        fi

        # ---- Detect public server IP ----
        # Priority 1: Env variable passed from Node.js (SERVER_PUBLIC_IP set in .env)
        SERVER_IP="${SERVER_PUBLIC_IP:-}"

        # Priority 2: Look for IP in an existing .ovpn file (most reliable - already used by Nyr before)
        if [ -z "$SERVER_IP" ]; then
            # Use find to avoid glob expansion issues, search in known client output dirs
            while IFS= read -r existing_ovpn; do
                FOUND_IP=$(grep -E "^remote " "$existing_ovpn" 2>/dev/null | head -1 | awk '{print $2}')
                # Only use if it's NOT a private/local IP
                if [ -n "$FOUND_IP" ] && ! echo "$FOUND_IP" | grep -qE '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.)'; then
                    SERVER_IP="$FOUND_IP"
                    echo "Detected public IP from existing profile: $existing_ovpn -> $SERVER_IP"
                    break
                fi
            done < <(find "$CLIENTS_DIR" /root /home -maxdepth 2 -name "*.ovpn" -type f 2>/dev/null)
        fi

        # Priority 3: Use curl/wget to detect public IP (like Nyr does)
        if [ -z "$SERVER_IP" ]; then
            echo "Attempting to auto-detect public IP..."
            SERVER_IP=$(curl -m 10 -4Ls "http://ip1.dynupdate.no-ip.com/" 2>/dev/null \
                     || wget -T 10 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" 2>/dev/null \
                     || curl -m 10 -4Ls "https://api.ipify.org" 2>/dev/null \
                     || wget -T 10 -t 1 -4qO- "https://api.ipify.org" 2>/dev/null)
            SERVER_IP=$(echo "$SERVER_IP" | grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$')
        fi

        # Priority 4: Fall back to the first non-loopback local IP (last resort)
        if [ -z "$SERVER_IP" ]; then
            echo "Warning: Could not detect public IP. Using local IP. Set SERVER_PUBLIC_IP in .env for correct behavior."
            SERVER_IP=$(ip -4 addr | grep inet | grep -vE '127(\.([0-9]{1,3})){3}' | cut -d'/' -f1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | head -1)
        fi

        echo "Using server IP: $SERVER_IP, proto: $SERVER_PROTO, port: $SERVER_PORT"

        # ---- Read server crypto options ----
        SERVER_CIPHER=""
        SERVER_DATA_CIPHERS=""
        SERVER_AUTH="SHA512"
        SERVER_COMPRESS=""
        if [ -f "$SERVER_CONF" ]; then
            CIPHER_LINE=$(grep -E "^[[:space:]]*cipher[[:space:]]+" "$SERVER_CONF" | head -1)
            [ -n "$CIPHER_LINE" ] && SERVER_CIPHER=$(echo "$CIPHER_LINE" | awk '{print $2}')

            DATA_CIPHERS_LINE=$(grep -E "^[[:space:]]*data-ciphers[[:space:]]+" "$SERVER_CONF" | head -1)
            [ -n "$DATA_CIPHERS_LINE" ] && SERVER_DATA_CIPHERS=$(echo "$DATA_CIPHERS_LINE" | awk '{print $2}')

            AUTH_LINE=$(grep -E "^[[:space:]]*auth[[:space:]]+" "$SERVER_CONF" | head -1)
            [ -n "$AUTH_LINE" ] && SERVER_AUTH=$(echo "$AUTH_LINE" | awk '{print $2}')

            COMPRESS_LINE=$(grep -E "^[[:space:]]*(compress|comp-lzo)([[:space:]]+|$)" "$SERVER_CONF" | head -1)
            [ -n "$COMPRESS_LINE" ] && SERVER_COMPRESS=$(echo "$COMPRESS_LINE" | awk '{$1=$1; print}')
        fi

        # ---- Read PKI certificates ----
        CA_CERT=$(cat "$EASYRSA_DIR/pki/ca.crt")
        # Only extract the PEM block from the issued cert (strip verbose human-readable metadata)
        CLIENT_CERT=$(sed -ne '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' "$EASYRSA_DIR/pki/issued/$CLIENT_NAME.crt")
        CLIENT_KEY=$(cat "$EASYRSA_DIR/pki/private/$CLIENT_NAME.key")

        # ---- Detect TLS key (tls-crypt or tls-auth) ----
        # Prefer the exact directive from server.conf. Nyr commonly uses tc.key.
        TLS_SECTION=""
        if [ -f "$SERVER_CONF" ]; then
            TLS_CRYPT_LINE=$(grep -E "^[[:space:]]*tls-crypt[[:space:]]+" "$SERVER_CONF" | head -1)
            if [ -n "$TLS_CRYPT_LINE" ]; then
                TLS_CRYPT_RAW=$(echo "$TLS_CRYPT_LINE" | awk '{print $2}')
                TLS_CRYPT_PATH=$(resolve_openvpn_path "$TLS_CRYPT_RAW")
                if [ -f "$TLS_CRYPT_PATH" ]; then
                    TLS_KEY=$(cat "$TLS_CRYPT_PATH")
                    TLS_SECTION="<tls-crypt>
$TLS_KEY
</tls-crypt>"
                    echo "Using tls-crypt key from server.conf: $TLS_CRYPT_PATH"
                fi
            fi

            if [ -z "$TLS_SECTION" ]; then
                TLS_AUTH_LINE=$(grep -E "^[[:space:]]*tls-auth[[:space:]]+" "$SERVER_CONF" | head -1)
                if [ -n "$TLS_AUTH_LINE" ]; then
                    TLS_AUTH_RAW=$(echo "$TLS_AUTH_LINE" | awk '{print $2}')
                    TLS_AUTH_DIRECTION=$(echo "$TLS_AUTH_LINE" | awk '{print $3}')
                    TLS_AUTH_PATH=$(resolve_openvpn_path "$TLS_AUTH_RAW")
                    if [ -f "$TLS_AUTH_PATH" ]; then
                        TLS_KEY=$(cat "$TLS_AUTH_PATH")
                        KEY_DIRECTION="1"
                        [ "$TLS_AUTH_DIRECTION" = "1" ] && KEY_DIRECTION="0"
                        TLS_SECTION="key-direction $KEY_DIRECTION
<tls-auth>
$TLS_KEY
</tls-auth>"
                        echo "Using tls-auth key from server.conf: $TLS_AUTH_PATH"
                    fi
                fi
            fi
        fi

        TLS_CRYPT_PATHS=(
            "$OPENVPN_DIR/tc.key"
            "$OPENVPN_DIR/tls-crypt.key"
            "/etc/openvpn/server/tls-crypt.key"
            "/etc/openvpn/server/tc.key"
            "/etc/openvpn/tls-crypt.key"
            "/etc/openvpn/tc.key"
        )
        TLS_AUTH_PATHS=(
            "$OPENVPN_DIR/ta.key"
            "$OPENVPN_DIR/tls-auth.key"
            "/etc/openvpn/server/tls-auth.key"
            "/etc/openvpn/server/ta.key"
            "/etc/openvpn/tls-auth.key"
            "/etc/openvpn/ta.key"
        )

        if [ -z "$TLS_SECTION" ]; then
            for tls_path in "${TLS_CRYPT_PATHS[@]}"; do
                if [ -f "$tls_path" ]; then
                    TLS_KEY=$(cat "$tls_path")
                    TLS_SECTION="<tls-crypt>
$TLS_KEY
</tls-crypt>"
                    echo "Using tls-crypt key from: $tls_path"
                    break
                fi
            done
        fi

        if [ -z "$TLS_SECTION" ]; then
            for tls_path in "${TLS_AUTH_PATHS[@]}"; do
                if [ -f "$tls_path" ]; then
                    TLS_KEY=$(cat "$tls_path")
                    TLS_SECTION="key-direction 1
<tls-auth>
$TLS_KEY
</tls-auth>"
                    echo "Using tls-auth key from: $tls_path"
                    break
                fi
            done
        fi

        if [ -z "$TLS_SECTION" ]; then
            echo "Warning: No tls-crypt or tls-auth key found. The profile may not connect if the server requires TLS auth."
        fi

        # ---- Compose the .ovpn file, matching Nyr's exact format ----
        OVPN_FILE="client
dev tun
proto $CLIENT_PROTO
remote $SERVER_IP $SERVER_PORT
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth $SERVER_AUTH"

        if [ -n "$SERVER_DATA_CIPHERS" ]; then
            OVPN_FILE="$OVPN_FILE
data-ciphers $SERVER_DATA_CIPHERS"
            if [ -n "$SERVER_CIPHER" ]; then
                OVPN_FILE="$OVPN_FILE
data-ciphers-fallback $SERVER_CIPHER"
            fi
        fi

        if [ -n "$SERVER_CIPHER" ]; then
            OVPN_FILE="$OVPN_FILE
cipher $SERVER_CIPHER"
        fi

        if [ -n "$SERVER_COMPRESS" ]; then
            OVPN_FILE="$OVPN_FILE
$SERVER_COMPRESS"
        fi

        OVPN_FILE="$OVPN_FILE
ignore-unknown-option block-outside-dns
verb 3
<ca>
$CA_CERT
</ca>
<cert>
$CLIENT_CERT
</cert>
<key>
$CLIENT_KEY
</key>"

        if [ -n "$TLS_SECTION" ]; then
            OVPN_FILE="$OVPN_FILE
$TLS_SECTION"
        fi

        # ---- Write .ovpn profile ----
        PROFILE_PATH="$CLIENTS_DIR/$CLIENT_NAME.ovpn"
        echo "$OVPN_FILE" > "$PROFILE_PATH"
        chmod 600 "$PROFILE_PATH"

        echo "Success: Client $CLIENT_NAME profile created at $PROFILE_PATH"
        exit 0
        ;;

    revoke)
        echo "=== REVOKE CLIENT: $CLIENT_NAME ==="

        if [ ! -d "$EASYRSA_DIR" ]; then
            echo "Error: Easy-RSA directory not found at $EASYRSA_DIR"
            exit 1
        fi

        # Check if the client certificate exists
        if [ ! -f "$EASYRSA_DIR/pki/issued/$CLIENT_NAME.crt" ]; then
            echo "Error: No certificate found for '$CLIENT_NAME'. Cannot revoke."
            exit 1
        fi

        cd "$EASYRSA_DIR" || exit 1

        # Revoke client certificate using Easy-RSA
        echo "Revoking certificate via Easy-RSA..."
        ./easyrsa --batch revoke "$CLIENT_NAME"
        revoke_exit=$?

        if [ $revoke_exit -ne 0 ]; then
            echo "Error: Easy-RSA revoke failed with exit code $revoke_exit"
            exit $revoke_exit
        fi

        # Generate new Certificate Revocation List (CRL)
        echo "Generating updated CRL..."
        ./easyrsa gen-crl
        crl_exit=$?

        if [ $crl_exit -ne 0 ]; then
            echo "Error: Failed to generate CRL"
            exit $crl_exit
        fi

        # Deploy CRL to OpenVPN server directory
        echo "Updating OpenVPN server CRL file..."
        if [ -d "/etc/openvpn/server" ]; then
            cp -f pki/crl.pem /etc/openvpn/server/crl.pem
            chmod 644 /etc/openvpn/server/crl.pem
        fi

        if [ -d "/etc/openvpn" ]; then
            cp -f pki/crl.pem /etc/openvpn/crl.pem
            chmod 644 /etc/openvpn/crl.pem
        fi

        # Delete client configuration (.ovpn) file from all known locations
        echo "Removing client configuration files..."
        rm -f "$CLIENTS_DIR/$CLIENT_NAME.ovpn"
        rm -f "/root/$CLIENT_NAME.ovpn"

        # Clean up from all home directories
        if [ -d "/home" ]; then
            for user_home in /home/*/; do
                rm -f "${user_home}${CLIENT_NAME}.ovpn"
            done
        fi

        echo "Success: Client $CLIENT_NAME certificate revoked"
        exit 0
        ;;

    purge)
        echo "=== PURGE REVOKED CLIENT: $CLIENT_NAME ==="

        INDEX_FILE="$EASYRSA_DIR/pki/index.txt"
        if [ ! -f "$INDEX_FILE" ]; then
            echo "Error: Easy-RSA index file not found at $INDEX_FILE"
            exit 1
        fi

        if ! awk -F '\t' -v cn="$CLIENT_NAME" '$1 == "R" && $6 ~ ("(^|[/,])CN=" cn "([/,]|$)") { found = 1 } END { exit found ? 0 : 1 }' "$INDEX_FILE"; then
            echo "Error: '$CLIENT_NAME' is not marked as revoked in Easy-RSA index. Revoke it before purging."
            exit 1
        fi

        if awk -F '\t' -v cn="$CLIENT_NAME" '$1 == "V" && $6 ~ ("(^|[/,])CN=" cn "([/,]|$)") { found = 1 } END { exit found ? 0 : 1 }' "$INDEX_FILE"; then
            echo "Error: '$CLIENT_NAME' also has an active certificate. Refusing to purge active material."
            exit 1
        fi

        PURGE_SERIALS=$(awk -F '\t' -v cn="$CLIENT_NAME" '$1 == "R" && $6 ~ ("(^|[/,])CN=" cn "([/,]|$)") { print $4 }' "$INDEX_FILE")
        BACKUP_FILE="$INDEX_FILE.bak.$(date +%Y%m%d%H%M%S)"
        cp -p "$INDEX_FILE" "$BACKUP_FILE"
        echo "Created Easy-RSA index backup at $BACKUP_FILE"

        TMP_INDEX=$(mktemp)
        awk -F '\t' -v cn="$CLIENT_NAME" '!($1 == "R" && $6 ~ ("(^|[/,])CN=" cn "([/,]|$)"))' "$INDEX_FILE" > "$TMP_INDEX"
        cat "$TMP_INDEX" > "$INDEX_FILE"
        rm -f "$TMP_INDEX"

        rm -f "$EASYRSA_DIR/pki/issued/$CLIENT_NAME.crt"
        rm -f "$EASYRSA_DIR/pki/private/$CLIENT_NAME.key"
        rm -f "$EASYRSA_DIR/pki/reqs/$CLIENT_NAME.req"

        for serial in $PURGE_SERIALS; do
            rm -f "$EASYRSA_DIR/pki/certs_by_serial/$serial.pem"
            rm -f "$EASYRSA_DIR/pki/revoked/certs_by_serial/$serial.crt"
            rm -f "$EASYRSA_DIR/pki/revoked/private_by_serial/$serial.key"
            rm -f "$EASYRSA_DIR/pki/revoked/reqs_by_serial/$serial.req"
        done

        echo "Removing client configuration files..."
        rm -f "$CLIENTS_DIR/$CLIENT_NAME.ovpn"
        rm -f "/root/$CLIENT_NAME.ovpn"
        if [ -d "/home" ]; then
            for user_home in /home/*/; do
                rm -f "${user_home}${CLIENT_NAME}.ovpn"
            done
        fi

        cd "$EASYRSA_DIR" || exit 1
        echo "Regenerating CRL after purge..."
        ./easyrsa gen-crl
        crl_exit=$?
        if [ $crl_exit -ne 0 ]; then
            echo "Error: Failed to regenerate CRL after purge"
            exit $crl_exit
        fi

        if [ -d "/etc/openvpn/server" ]; then
            cp -f pki/crl.pem /etc/openvpn/server/crl.pem
            chmod 644 /etc/openvpn/server/crl.pem
        fi

        if [ -d "/etc/openvpn" ]; then
            cp -f pki/crl.pem /etc/openvpn/crl.pem
            chmod 644 /etc/openvpn/crl.pem
        fi

        echo "Success: Revoked client $CLIENT_NAME purged from Easy-RSA records"
        exit 0
        ;;

    *)
        echo "Error: Unknown command: $COMMAND"
        exit 1
        ;;
esac
