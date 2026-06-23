const path = require('path');
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123', // Admin password for login
  jwtSecret: process.env.JWT_SECRET || 'ovpn-manager-jwt-secret-key-change-me-123456789',
  jwtExpiry: '2h', // Session token duration
  
  // OpenVPN status log path (usually /var/log/openvpn/openvpn-status.log or /etc/openvpn/server/openvpn-status.log)
  openvpnStatusLog: process.env.OPENVPN_STATUS_LOG || '/var/log/openvpn/openvpn-status.log',
  
  // Easy-RSA certificate index file path to identify created/revoked clients
  easyRsaIndex: process.env.EASYRSA_INDEX || '/etc/openvpn/easy-rsa/pki/index.txt',
  
  // Directory where Nyr's script saves the generated client .ovpn profiles (usually /root or user's home)
  clientsDir: process.env.CLIENTS_DIR || '/root',

  // Path to the OpenVPN installer script (used to generate client profiles)
  openvpnInstallScript: process.env.OPENVPN_INSTALL_SCRIPT || '/root/openvpn-install.sh',
  
  // Path to the bash script wrapper for adding/revoking clients
  vpnOpsScript: process.env.VPN_OPS_SCRIPT || path.join(__dirname, 'vpn-ops.sh'),

  // Public IP or hostname of the VPN server (used in generated .ovpn profiles)
  // IMPORTANT: set this in .env to your server's public IP (e.g., SERVER_PUBLIC_IP=186.113.104.161)
  serverPublicIp: process.env.SERVER_PUBLIC_IP || '',

  // Bandwidth monitor interface (tun0 is the default OpenVPN virtual interface, which tracks only VPN traffic)
  monitorInterface: process.env.MONITOR_INTERFACE || 'tun0'
};
