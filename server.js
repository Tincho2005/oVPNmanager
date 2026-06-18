const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const crypto = require('crypto');
const config = require('./config');

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// CORS headers (optional, for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Helper: Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Please log in.' });
  }

  try {
    const verified = jwt.verify(token, config.jwtSecret);
    req.user = verified;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
  }
};

// Rolling Bandwidth History (in-memory buffer)
const bandwidthHistory = [];
const HISTORY_LIMIT = 30; // Keeps last 60 seconds of samples (at 2s intervals)
let lastRxBytes = 0;
let lastTxBytes = 0;
let lastInterface = '';
let lastSampleTime = Date.now();
let lastCpuSample = null;

// Path Auto-Detection for Easy-RSA index.txt
function detectEasyRsaIndex() {
  if (fs.existsSync(config.easyRsaIndex)) {
    return config.easyRsaIndex;
  }
  const paths = [
    '/etc/openvpn/easy-rsa/pki/index.txt',
    '/etc/openvpn/server/easy-rsa/pki/index.txt',
    '/etc/openvpn/easy-rsa/3/pki/index.txt',
    '/etc/openvpn/server/easy-rsa/3/pki/index.txt',
    '/etc/openvpn/server/pki/index.txt',
    '/etc/openvpn/pki/index.txt'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`Auto-detected Easy-RSA index at: ${p}`);
      return p;
    }
  }
  return config.easyRsaIndex; // Fallback to config default
}

// Path Auto-Detection for OpenVPN status log
function detectOpenVpnStatusLog() {
  if (fs.existsSync(config.openvpnStatusLog)) {
    return config.openvpnStatusLog;
  }
  
  // Try to parse from server configurations
  const confCandidates = [
    '/etc/openvpn/server.conf',
    '/etc/openvpn/server/server.conf'
  ];
  for (const confPath of confCandidates) {
    if (fs.existsSync(confPath)) {
      try {
        const confContent = fs.readFileSync(confPath, 'utf8');
        const statusMatch = confContent.match(/^status\s+(.+)$/m);
        if (statusMatch) {
          let statusPath = statusMatch[1].trim();
          if (!path.isAbsolute(statusPath)) {
            statusPath = path.join(path.dirname(confPath), statusPath);
          }
          if (fs.existsSync(statusPath)) {
            console.log(`Auto-detected OpenVPN status log from server config: ${statusPath}`);
            return statusPath;
          }
        }
      } catch (e) {
        console.error(`Error reading conf path ${confPath}:`, e.message);
      }
    }
  }

  const paths = [
    '/var/log/openvpn/openvpn-status.log',
    '/var/log/openvpn-status.log',
    '/var/log/openvpn/status.log',
    '/etc/openvpn/openvpn-status.log',
    '/run/openvpn-server/status-server.log',
    '/run/openvpn/status.log'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`Auto-detected OpenVPN status log at: ${p}`);
      return p;
    }
  }
  return config.openvpnStatusLog; // Fallback to config default
}

// Path Auto-Detection for OpenVPN installer script
function detectOpenVpnInstallScript() {
  if (fs.existsSync(config.openvpnInstallScript)) {
    return config.openvpnInstallScript;
  }
  const paths = [
    '/root/openvpn-install.sh',
    '/etc/openvpn/openvpn-install.sh',
    '/usr/local/bin/openvpn-install.sh',
    path.join(__dirname, 'openvpn-install.sh')
  ];
  
  // Try home directories
  try {
    if (fs.existsSync('/home')) {
      const users = fs.readdirSync('/home');
      for (const user of users) {
        const userHome = path.join('/home', user);
        if (fs.statSync(userHome).isDirectory()) {
          paths.push(path.join(userHome, 'openvpn-install.sh'));
        }
      }
    }
  } catch (e) {
    // Ignore error
  }

  for (const p of paths) {
    if (fs.existsSync(p)) {
      console.log(`Auto-detected OpenVPN installer script at: ${p}`);
      return p;
    }
  }
  return config.openvpnInstallScript; // Fallback to config default
}

// Search utility for .ovpn configuration profiles in multiple possible paths
function findConfigFile(clientName) {
  const fileName = `${clientName}.ovpn`;
  
  // 1. Check clientsDir from config
  let filePath = path.join(config.clientsDir, fileName);
  if (fs.existsSync(filePath)) return filePath;

  // 2. Check /root
  filePath = path.join('/root', fileName);
  if (fs.existsSync(filePath)) return filePath;

  // 3. Scan /home subdirectories
  try {
    if (fs.existsSync('/home')) {
      const users = fs.readdirSync('/home');
      for (const user of users) {
        const userHome = path.join('/home', user);
        if (fs.statSync(userHome).isDirectory()) {
          filePath = path.join(userHome, fileName);
          if (fs.existsSync(filePath)) return filePath;
        }
      }
    }
  } catch (e) {
    // Ignore errors reading /home
  }

  return null;
}

// Parser: /proc/net/dev (Network Bandwidth)
function getInterfaceBytes(iface) {
  return new Promise((resolve) => {
    fs.readFile('/proc/net/dev', 'utf8', (err, data) => {
      const isLinux = os.platform() === 'linux';
      if (err) {
        // Return 0/mock if proc files aren't available (e.g. running locally on macOS/Windows)
        return resolve({ rx: 0, tx: 0, isMock: !isLinux, interface: 'mock' });
      }

      const lines = data.split('\n');

      // 1. If explicit interface is requested (and it's not 'auto')
      if (iface && iface !== 'auto') {
        for (const line of lines) {
          if (line.includes(iface + ':')) {
            const parts = line.split(iface + ':')[1].trim().split(/\s+/);
            const rx = parseInt(parts[0], 10) || 0;
            const tx = parseInt(parts[8], 10) || 0;
            return resolve({ rx, tx, isMock: false, interface: iface });
          }
        }
        
        // If the requested interface is a VPN tunnel (tun/tap) and it's not found in proc,
        // we assume the VPN is stopped or idle, returning 0 traffic rather than switching to system interface
        if (iface.startsWith('tun') || iface.startsWith('tap')) {
          return resolve({ rx: 0, tx: 0, isMock: !isLinux, interface: iface });
        }
      }

      // 2. Auto-detect interface
      // First, look for any active VPN interface (tun* or tap*)
      for (const line of lines) {
        if (!line.includes(':') || line.includes('lo:') || line.includes('docker') || line.includes('br-')) continue;
        const match = line.match(/^\s*(tun[0-9]+|tap[0-9]+):/);
        if (match) {
          const foundIface = match[1];
          const parts = line.split(foundIface + ':')[1].trim().split(/\s+/);
          const rx = parseInt(parts[0], 10) || 0;
          const tx = parseInt(parts[8], 10) || 0;
          return resolve({ rx, tx, isMock: false, interface: foundIface });
        }
      }

      // Next, look for any other active physical interface (e.g. eth*, ens*, enp*, wlan*, etc.)
      for (const line of lines) {
        if (!line.includes(':') || line.includes('lo:') || line.includes('docker') || line.includes('br-')) continue;
        const match = line.match(/^\s*([a-zA-Z0-9_-]+):/);
        if (match) {
          const foundIface = match[1];
          const parts = line.split(foundIface + ':')[1].trim().split(/\s+/);
          const rx = parseInt(parts[0], 10) || 0;
          const tx = parseInt(parts[8], 10) || 0;
          return resolve({ rx, tx, isMock: false, interface: foundIface });
        }
      }

      resolve({ rx: 0, tx: 0, isMock: !isLinux, interface: 'none' });
    });
  });
}

function readLinuxCpuSample() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
    if (stat[0] !== 'cpu') return null;

    const values = stat.slice(1).map(value => parseInt(value, 10) || 0);
    const idle = values[3] + (values[4] || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { idle, total };
  } catch (err) {
    return null;
  }
}

function getCpuUsagePercent() {
  const isLinux = os.platform() === 'linux';
  if (isLinux) {
    const current = readLinuxCpuSample();
    if (current) {
      if (lastCpuSample && current.total > lastCpuSample.total) {
        const idleDelta = current.idle - lastCpuSample.idle;
        const totalDelta = current.total - lastCpuSample.total;
        lastCpuSample = current;
        const usage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
        return Math.max(0, Math.min(100, Math.round(usage)));
      }

      lastCpuSample = current;
    }
  }

  const cpuCount = Math.max(os.cpus().length, 1);
  return Math.max(0, Math.min(100, Math.round((os.loadavg()[0] / cpuCount) * 100)));
}

function getRamUsagePercent() {
  if (os.platform() === 'linux') {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const values = {};
      for (const line of meminfo.split('\n')) {
        const match = line.match(/^(\w+):\s+(\d+)/);
        if (match) values[match[1]] = parseInt(match[2], 10);
      }

      if (values.MemTotal) {
        const available = values.MemAvailable || (values.MemFree + (values.Buffers || 0) + (values.Cached || 0));
        return Math.max(0, Math.min(100, Math.round(((values.MemTotal - available) / values.MemTotal) * 100)));
      }
    } catch (err) {
      // Fall back to Node's cross-platform memory counters below.
    }
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return Math.max(0, Math.min(100, Math.round(((totalMem - freeMem) / totalMem) * 100)));
}

function getOpenVpnServiceStatus(callback) {
  if (os.platform() !== 'linux') {
    exec('pgrep -x openvpn', (err, stdout) => {
      callback(null, /^[0-9]+$/m.test(stdout.trim()));
    });
    return;
  }

  exec('systemctl list-units --type=service --all --no-legend "openvpn*.service" 2>/dev/null', (err, stdout) => {
    const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
    const activeUnit = lines.some(line => {
      const parts = line.split(/\s+/);
      return /^openvpn.*\.service$/.test(parts[0]) && parts[2] === 'active' && parts[3] === 'running';
    });

    if (activeUnit) {
      callback(null, true);
      return;
    }

    if (lines.length > 0) {
      callback(null, false);
      return;
    }

    exec('pgrep -x openvpn', (pgrepErr, pgrepStdout) => {
      callback(null, /^[0-9]+$/m.test(pgrepStdout.trim()));
    });
  });
}

// Monitor Ticker: Updates Bandwidth Speed
setInterval(async () => {
  const now = Date.now();
  const timeDelta = (now - lastSampleTime) / 1000; // seconds
  if (timeDelta <= 0) return;

  const data = await getInterfaceBytes(config.monitorInterface);
  const currentIface = data.interface || '';

  // Reset baseline counters if interface changed to prevent massive speed spikes
  if (currentIface !== lastInterface) {
    lastRxBytes = 0;
    lastTxBytes = 0;
    lastInterface = currentIface;
  }

  let rxSpeed = 0;
  let txSpeed = 0;

  if (data.isMock) {
    // Generate mock traffic only if we are not on Linux (so UI demo is responsive during development)
    rxSpeed = Math.floor(Math.random() * 500000) + 100000; // 100 - 600 KB/s
    txSpeed = Math.floor(Math.random() * 200000) + 50000;   // 50 - 250 KB/s
  } else {
    // Calculate speed in bytes per second
    if (lastRxBytes > 0 && data.rx >= lastRxBytes) {
      rxSpeed = (data.rx - lastRxBytes) / timeDelta;
    }
    if (lastTxBytes > 0 && data.tx >= lastTxBytes) {
      txSpeed = (data.tx - lastTxBytes) / timeDelta;
    }

    lastRxBytes = data.rx;
    lastTxBytes = data.tx;
  }

  lastSampleTime = now;

  bandwidthHistory.push({
    time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    rx: rxSpeed, // bytes/s (download rate)
    tx: txSpeed  // bytes/s (upload rate)
  });

  if (bandwidthHistory.length > HISTORY_LIMIT) {
    bandwidthHistory.shift();
  }
}, 2000);

// Parser: Easy-RSA index.txt
function parseEasyRsaIndex(filePath) {
  try {
    let activePath = filePath;
    if (!activePath || !fs.existsSync(activePath)) {
      activePath = detectEasyRsaIndex();
    }
    if (!fs.existsSync(activePath)) {
      console.warn(`Easy-RSA Index file not found at ${activePath || filePath}. Returning empty list.`);
      return [];
    }

    const content = fs.readFileSync(activePath, 'utf8');
    const clients = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 6) continue;

      const status = parts[0]; // V = Valid, R = Revoked, E = Expired
      const expirationStr = parts[1];
      const revocationStr = parts[2];
      const subject = parts[5];

      // Match CN from subject string
      const cnMatch = subject.match(/\/CN=([^/]+)/) || subject.match(/CN=([^,]+)/);
      if (!cnMatch) continue;

      const cn = cnMatch[1].trim();
      if (cn === 'server') continue; // Skip the server's own certificate

      // Helper to parse Easy-RSA date format YYMMDDHHMMSSZ to standard Date
      const parseEasyRsaDate = (dateStr) => {
        if (!dateStr) return null;
        const year = parseInt(dateStr.substring(0, 2), 10) + 2000;
        const month = parseInt(dateStr.substring(2, 4), 10) - 1;
        const day = parseInt(dateStr.substring(4, 6), 10);
        const hour = parseInt(dateStr.substring(6, 8), 10);
        const minute = parseInt(dateStr.substring(8, 10), 10);
        const second = parseInt(dateStr.substring(10, 12), 10);
        return new Date(Date.UTC(year, month, day, hour, minute, second));
      };

      clients.push({
        name: cn,
        status: status === 'V' ? 'Active' : status === 'R' ? 'Revoked' : 'Expired',
        expirationDate: parseEasyRsaDate(expirationStr),
        revocationDate: status === 'R' ? parseEasyRsaDate(revocationStr) : null
      });
    }
    return clients;
  } catch (err) {
    if (err.code === 'EACCES') {
      console.error(`EACCES: Permission denied reading Easy-RSA index. Make sure the server runs with sufficient privileges.`);
    } else {
      console.error('Error parsing Easy-RSA index:', err);
    }
    return [];
  }
}

// Parser: OpenVPN status log
function parseOpenVpnStatus(filePath) {
  try {
    let activePath = filePath;
    if (!activePath || !fs.existsSync(activePath)) {
      activePath = detectOpenVpnStatusLog();
    }
    if (!fs.existsSync(activePath)) {
      console.warn(`OpenVPN status log not found at ${activePath || filePath}. Returning empty active user list.`);
      return [];
    }

    const content = fs.readFileSync(activePath, 'utf8');
    const lines = content.split('\n');
    const activeUsers = [];

    // Detect if log format is version 2/3 (using comma separated CLIENT_LIST prefixes)
    const isV2Format = lines.some(line => line.startsWith('HEADER,CLIENT_LIST') || line.startsWith('CLIENT_LIST'));

    if (isV2Format) {
      for (const line of lines) {
        const parts = line.split(',');
        if (parts[0] === 'CLIENT_LIST') {
          // CLIENT_LIST, Common Name, Real Address, Virtual Address, Virtual IPv6 Address, Bytes Received, Bytes Sent, Connected Since, Connected Since (time_t)
          const commonName = parts[1];
          if (commonName && commonName !== 'UNDEF' && commonName !== 'Common Name') {
            activeUsers.push({
              name: commonName,
              realAddress: parts[2] || 'N/A',
              virtualAddress: parts[3] || 'N/A',
              bytesReceived: parseInt(parts[5], 10) || 0,
              bytesSent: parseInt(parts[6], 10) || 0,
              connectedSince: parts[7] || 'N/A',
              connectedSinceTimestamp: (parseInt(parts[8], 10) * 1000) || Date.now()
            });
          }
        }
      }
    } else {
      // Format 1 (Standard table-like log)
      // Extract client lines between header and ROUTING TABLE
      let inClientSection = false;
      for (const line of lines) {
        if (line.includes('Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since')) {
          inClientSection = true;
          continue;
        }
        if (line.includes('ROUTING TABLE') || line.includes('Virtual Address,Common Name')) {
          inClientSection = false;
          continue;
        }

        if (inClientSection) {
          const parts = line.split(',');
          if (parts.length >= 5 && parts[0] !== 'Common Name' && parts[0] !== 'UNDEF' && parts[0].trim()) {
            activeUsers.push({
              name: parts[0],
              realAddress: parts[1] || 'N/A',
              virtualAddress: 'N/A', // routing table will enrich this below
              bytesReceived: parseInt(parts[2], 10) || 0,
              bytesSent: parseInt(parts[3], 10) || 0,
              connectedSince: parts[4] || 'N/A',
              connectedSinceTimestamp: Date.parse(parts[4]) || Date.now()
            });
          }
        }
      }

      // Read routing table to match virtual IP addresses
      let inRoutingSection = false;
      for (const line of lines) {
        if (line.includes('ROUTING TABLE') || line.includes('Virtual Address,Common Name,Real Address')) {
          inRoutingSection = true;
          continue;
        }
        if (line.includes('GLOBAL STATS') || line.includes('GLOBAL_STATS')) {
          inRoutingSection = false;
          continue;
        }

        if (inRoutingSection) {
          const parts = line.split(',');
          if (parts.length >= 3 && parts[0] !== 'Virtual Address') {
            const virtualIp = parts[0];
            const commonName = parts[1];
            const user = activeUsers.find(u => u.name === commonName);
            if (user) {
              user.virtualAddress = virtualIp;
            }
          }
        }
      }
    }

    return activeUsers;
  } catch (err) {
    if (err.code === 'EACCES') {
      console.error(`EACCES: Permission denied reading OpenVPN status log. Make sure the server runs with sufficient privileges.`);
    } else {
      console.error('Error parsing OpenVPN status log:', err);
    }
    return [];
  }
}

// REST APIs

// 1. Auth Endpoint (Login)
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  // Compare input password to configured password
  if (password !== config.adminPassword) {
    return res.status(401).json({ error: 'Incorrect administrator password.' });
  }

  // Generate JWT Token
  const token = jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: config.jwtExpiry });

  // Set HttpOnly Cookie (secure & session based)
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // true in prod
    sameSite: 'strict',
    maxAge: 2 * 60 * 60 * 1000 // 2 hours
  });

  return res.json({ success: true, message: 'Authenticated successfully' });
});

// 2. Auth Endpoint (Logout)
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  return res.json({ success: true, message: 'Logged out successfully' });
});

// 3. Auth Check Session
app.get('/api/auth/session', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    jwt.verify(token, config.jwtSecret);
    return res.json({ authenticated: true });
  } catch (err) {
    res.clearCookie('auth_token');
    return res.json({ authenticated: false });
  }
});

// --- ALL ENDPOINTS BEYOND THIS REQUIRE AUTHENTICATION ---
app.use('/api', authenticateToken);

// 4. System Status (Dashboard metrics)
app.get('/api/status', (req, res) => {
  getOpenVpnServiceStatus((err, serviceActive) => {
    const cpuPercent = getCpuUsagePercent();
    const ramPercent = getRamUsagePercent();
    const activeClients = serviceActive ? parseOpenVpnStatus(config.openvpnStatusLog) : [];

    return res.json({
      openvpnActive: serviceActive,
      cpuLoad: Math.min(cpuPercent, 100),
      ramUsage: ramPercent,
      systemUptime: os.uptime(),
      activeConnectionsCount: activeClients.length
    });
  });
});

// 5. Live Bandwidth graph metrics
app.get('/api/bandwidth-history', (req, res) => {
  return res.json(bandwidthHistory);
});

// 6. List Client Accounts (Merged view: EasyRSA index + Status logs + Config files)
app.get('/api/clients', (req, res) => {
  const easyRsaClients = parseEasyRsaIndex(config.easyRsaIndex);
  const isLinux = os.platform() === 'linux';

  // Fallback mocks if testing in empty local setup
  if (easyRsaClients.length === 0 && !isLinux && process.env.NODE_ENV !== 'production') {
    // Return sample users for demonstration in local environments
    const mockClients = [
      { name: 'juan_pc', status: 'Active', expirationDate: new Date(Date.now() + 31536000000), revocationDate: null, hasConfigFile: true, connected: true, ip: '186.22.41.9', virtualIp: '10.8.0.6', uploaded: 512400, downloaded: 4892400, connectedSince: 'Mon Jun 15 16:00:00 2026' },
      { name: 'maria_celular', status: 'Active', expirationDate: new Date(Date.now() + 31536000000), revocationDate: null, hasConfigFile: true, connected: false },
      { name: 'pedro_notebook', status: 'Revoked', expirationDate: new Date(Date.now() + 31536000000), revocationDate: new Date(), hasConfigFile: false, connected: false }
    ];
    return res.json(mockClients);
  }

  getOpenVpnServiceStatus((err, serviceActive) => {
    const activeClients = serviceActive ? parseOpenVpnStatus(config.openvpnStatusLog) : [];

    // Map each client certificate record
    const result = easyRsaClients.map(client => {
      const active = activeClients.find(ac => ac.name === client.name);
      const configPath = findConfigFile(client.name);
      
      return {
        name: client.name,
        status: client.status,
        expirationDate: client.expirationDate,
        revocationDate: client.revocationDate,
        hasConfigFile: !!configPath,
        connected: !!active,
        ip: active ? active.realAddress : null,
        virtualIp: active ? active.virtualAddress : null,
        uploaded: active ? active.bytesSent : 0,
        downloaded: active ? active.bytesReceived : 0,
        connectedSince: active ? active.connectedSince : null
      };
    });

    return res.json(result);
  });
});

// 7. Add client (Alta)
app.post('/api/clients', (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Client name is required.' });
  }

  // Validate client name
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid name. Use alphanumeric characters, dashes, and underscores only.' });
  }

  // Verify if client already exists in Easy-RSA index
  const clients = parseEasyRsaIndex(config.easyRsaIndex);
  const existingClient = clients.find(c => c.name === name);
  if (existingClient && existingClient.status === 'Active') {
    return res.status(400).json({ error: `A client named '${name}' already exists and is active.` });
  }
  if (existingClient && existingClient.status === 'Revoked') {
    return res.status(409).json({ error: `Client '${name}' is revoked. Purge it first if you want to create a new client with the same name.` });
  }

  // Run shell helper to add client
  const installScript = detectOpenVpnInstallScript();
  const env = { ...process.env, OPENVPN_INSTALL_SCRIPT: installScript, CLIENTS_DIR: config.clientsDir, TERM: 'linux', SERVER_PUBLIC_IP: config.serverPublicIp };
  exec(`"${config.vpnOpsScript}" add "${name}"`, { env, timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    if (err) {
      const detailMsg = (stderr || err.message || '').trim();
      console.error('Add client execution error:', detailMsg);
      return res.status(500).json({ 
        error: `Failed to create client certificate. Details: ${detailMsg}`, 
        details: detailMsg 
      });
    }
    
    console.log(`Add client script stdout:\n${stdout}`);
    return res.json({ success: true, message: `Client '${name}' created successfully.` });
  });
});

// 8. Revoke client (Baja)
app.delete('/api/clients/:name', (req, res) => {
  const name = req.params.name;

  if (!name) {
    return res.status(400).json({ error: 'Client name is required.' });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid client name format.' });
  }

  // Run shell helper to revoke client
  const env = { ...process.env, CLIENTS_DIR: config.clientsDir, TERM: 'linux' };
  exec(`"${config.vpnOpsScript}" revoke "${name}"`, { env, timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    if (err) {
      const detailMsg = (stderr || err.message || '').trim();
      console.error('Revoke client execution error:', detailMsg);
      return res.status(500).json({ 
        error: `Failed to revoke client certificate. Details: ${detailMsg}`, 
        details: detailMsg 
      });
    }
    
    console.log(`Revoke client script stdout:\n${stdout}`);
    return res.json({ success: true, message: `Client '${name}' revoked successfully.` });
  });
});

// 9. Purge revoked client from Easy-RSA records
app.post('/api/clients/:name/purge', (req, res) => {
  const name = req.params.name;

  if (!name) {
    return res.status(400).json({ error: 'Client name is required.' });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid client name format.' });
  }

  const clients = parseEasyRsaIndex(config.easyRsaIndex);
  const client = clients.find(c => c.name === name);
  if (!client) {
    return res.status(404).json({ error: `Client '${name}' was not found in Easy-RSA records.` });
  }

  if (client.status !== 'Revoked') {
    return res.status(400).json({ error: `Client '${name}' must be revoked before it can be purged.` });
  }

  const env = { ...process.env, CLIENTS_DIR: config.clientsDir, TERM: 'linux' };
  exec(`"${config.vpnOpsScript}" purge "${name}"`, { env, timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    if (err) {
      const detailMsg = (stderr || stdout || err.message || '').trim();
      console.error('Purge client execution error:', detailMsg);
      return res.status(500).json({ 
        error: `Failed to purge revoked client. Details: ${detailMsg}`, 
        details: detailMsg 
      });
    }
    
    console.log(`Purge client script stdout:\n${stdout}`);
    return res.json({ success: true, message: `Revoked client '${name}' purged successfully.` });
  });
});

// 10. Download .ovpn Configuration file
app.get('/api/clients/:name/download', (req, res) => {
  const name = req.params.name;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid client name format.' });
  }

  const sendProfile = () => {
    const filePath = findConfigFile(name);

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: `Config profile file '${name}.ovpn' was not found on the server.` });
    }

    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.ovpn"`);
    
    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (err) => {
      console.error('Error reading OVPN file stream:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream config file.' });
      }
    });
    
    fileStream.pipe(res);
  };

  const clients = parseEasyRsaIndex(config.easyRsaIndex);
  const client = clients.find(c => c.name === name);

  if (!client || client.status !== 'Active') {
    return sendProfile();
  }

  const env = { ...process.env, CLIENTS_DIR: config.clientsDir, TERM: 'linux', SERVER_PUBLIC_IP: config.serverPublicIp };
  exec(`"${config.vpnOpsScript}" profile "${name}"`, { env, timeout: 20000, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
    if (err) {
      const detailMsg = (stderr || stdout || err.message || '').trim();
      console.error('Regenerate profile execution error:', detailMsg);
      return res.status(500).json({ 
        error: `Failed to regenerate client profile. Details: ${detailMsg}`, 
        details: detailMsg 
      });
    }

    console.log(`Regenerate profile script stdout:\n${stdout}`);
    return sendProfile();
  });
});

// Serve UI for anything else (SPA client fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(config.port, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(` oVPNmanager is running on port ${config.port} `);
  console.log(` Access dashboard at http://localhost:${config.port} `);
  console.log(`=========================================`);
});
