// oVPNmanager Frontend Application Controller

// State Management
const state = {
    authenticated: false,
    activeView: 'login',
    language: localStorage.getItem('ovpnmanager_language') || 'en',
    clients: [],
    statusPollInterval: null,
    clientsPollInterval: null,
    bandwidthPollInterval: null,
    chart: null,
    selectedClientToRevoke: null,
    serviceStatus: 'detecting',
    filter: 'all',
    searchQuery: ''
};

const i18n = {
    en: {
        'app.title': 'oVPNmanager - OpenVPN Dashboard',
        'login.subtitle': 'OpenVPN Server Administration',
        'login.passwordLabel': 'Administrator Password',
        'login.submit': 'Sign In',
        'login.success': 'Signed in successfully',
        'login.badPassword': 'Incorrect password',
        'login.backendError': 'Connection error with the backend.',
        'session.serverError': 'Error connecting to the server',
        'actions.logout': 'Sign Out',
        'actions.exit': 'Exit',
        'actions.cancel': 'Cancel',
        'actions.generateProfile': 'Generate Profile',
        'actions.revokeAccess': 'Revoke Access',
        'actions.downloadProfile': 'Download Configuration (.ovpn)',
        'actions.revokeUser': 'Revoke User Access',
        'actions.purgeUser': 'Purge and Remove from List',
        'status.detecting': 'Detecting...',
        'status.online': 'Online',
        'status.offline': 'Offline',
        'status.active': 'Active',
        'status.inactive': 'Inactive',
        'status.unreachable': 'No response',
        'status.serviceOnlineSub': 'OpenVPN running normally',
        'status.serviceOfflineSub': 'The OpenVPN daemon is stopped',
        'status.serviceUnreachableSub': 'The web service is not responding from the server',
        'status.serviceDetectingSub': 'OpenVPN Server Daemon',
        'stats.serviceTitle': 'Service Status',
        'stats.connectionsTitle': 'Active Connections',
        'stats.connectionsSub': 'Users connected now',
        'stats.cpuTitle': 'CPU Load',
        'stats.cpuSub': 'Processor usage',
        'stats.ramTitle': 'RAM Memory',
        'stats.ramSub': 'System memory usage',
        'bandwidth.title': 'Network Bandwidth (Live)',
        'bandwidth.download': 'Download (RX)',
        'bandwidth.upload': 'Upload (TX)',
        'clients.title': 'Users and Credentials',
        'clients.createUser': 'Create User',
        'clients.searchPlaceholder': 'Search user by name...',
        'clients.loading': 'Loading users...',
        'clients.empty': 'No user certificates were found on the server.',
        'clients.noMatches': 'No user matches the search criteria.',
        'clients.created': "User '{name}' created successfully.",
        'clients.revoked': "User '{name}' revoked successfully.",
        'clients.purged': "Revoked user '{name}' purged successfully.",
        'clients.createError': 'Error creating user',
        'clients.revokeError': 'Error revoking user',
        'clients.purgeError': 'Error purging revoked user',
        'clients.createNetworkError': 'Connection error.',
        'clients.revokeNetworkError': 'Network error while revoking user',
        'clients.purgeNetworkError': 'Network error while purging revoked user',
        'clients.purgeConfirm': "Permanently purge '{name}' from Easy-RSA records?",
        'filters.all': 'All',
        'filters.connected': 'Connected',
        'filters.active': 'Enabled',
        'filters.revoked': 'Revoked',
        'table.user': 'User',
        'table.status': 'Status',
        'table.virtualIp': 'Virtual IP',
        'table.publicIp': 'Public IP',
        'table.traffic': 'Received/Sent Traffic',
        'table.connectionExpiration': 'Connection / Expiration',
        'table.actions': 'Actions',
        'badges.connected': 'Connected',
        'badges.enabled': 'Enabled',
        'badges.revoked': 'Revoked',
        'date.expiration': 'Expiration:',
        'date.revokedOn': 'Revoked on:',
        'date.connected': 'Connected:',
        'modal.createTitle': 'Create New User',
        'modal.createDesc': 'The script will generate a new cryptographic key and compile the matching configuration profile (.ovpn).',
        'modal.clientName': 'Client Name',
        'modal.usernamePlaceholder': 'e.g. john_laptop',
        'modal.usernameTitle': 'Only letters, numbers, dashes, and underscores.',
        'modal.usernameHint': 'Only alphanumeric characters, dashes, and underscores are allowed (no spaces).',
        'modal.revokeTitle': 'Confirm Revocation',
        'modal.revokeQuestionPrefix': 'Are you sure you want to revoke',
        'modal.revokeDesc': 'This action permanently invalidates the SSL/TLS certificate on the server. The user will lose connection immediately and will not be able to reconnect with this profile. The .ovpn file will be deleted.',
        'loading.creating': 'Creating...',
        'loading.revoking': 'Revoking...',
        'toast.notification': 'Notification',
        'logout.closed': 'Session closed'
    },
    es: {
        'app.title': 'oVPNmanager - Panel OpenVPN',
        'login.subtitle': 'Administración de Servidor OpenVPN',
        'login.passwordLabel': 'Contraseña de Administrador',
        'login.submit': 'Iniciar Sesión',
        'login.success': 'Sesión iniciada correctamente',
        'login.badPassword': 'Contraseña incorrecta',
        'login.backendError': 'Error de conexión con el backend.',
        'session.serverError': 'Error al conectar con el servidor',
        'actions.logout': 'Cerrar Sesión',
        'actions.exit': 'Salir',
        'actions.cancel': 'Cancelar',
        'actions.generateProfile': 'Generar Perfil',
        'actions.revokeAccess': 'Revocar Acceso',
        'actions.downloadProfile': 'Descargar Configuración (.ovpn)',
        'actions.revokeUser': 'Revocar Acceso del Usuario',
        'actions.purgeUser': 'Purgar y Eliminar de la Lista',
        'status.detecting': 'Detectando...',
        'status.online': 'Online',
        'status.offline': 'Offline',
        'status.active': 'Activo',
        'status.inactive': 'Inactivo',
        'status.unreachable': 'Sin respuesta',
        'status.serviceOnlineSub': 'OpenVPN ejecutándose normalmente',
        'status.serviceOfflineSub': 'El daemon de OpenVPN está detenido',
        'status.serviceUnreachableSub': 'La web no responde desde el servidor',
        'status.serviceDetectingSub': 'OpenVPN Server Daemon',
        'stats.serviceTitle': 'Estado del Servicio',
        'stats.connectionsTitle': 'Conexiones Activas',
        'stats.connectionsSub': 'Usuarios conectados ahora',
        'stats.cpuTitle': 'Carga del CPU',
        'stats.cpuSub': 'Uso del procesador',
        'stats.ramTitle': 'Memoria RAM',
        'stats.ramSub': 'Uso de memoria del sistema',
        'bandwidth.title': 'Ancho de Banda de Red (Live)',
        'bandwidth.download': 'Descarga (RX)',
        'bandwidth.upload': 'Subida (TX)',
        'clients.title': 'Usuarios y Credenciales',
        'clients.createUser': 'Crear Usuario',
        'clients.searchPlaceholder': 'Buscar usuario por nombre...',
        'clients.loading': 'Cargando usuarios...',
        'clients.empty': 'No se encontraron certificados de usuarios creados en el servidor.',
        'clients.noMatches': 'Ningún usuario coincide con los criterios de búsqueda.',
        'clients.created': "Usuario '{name}' creado exitosamente.",
        'clients.revoked': "Usuario '{name}' revocado exitosamente.",
        'clients.purged': "Usuario revocado '{name}' purgado correctamente.",
        'clients.createError': 'Error al crear usuario',
        'clients.revokeError': 'Error al revocar usuario',
        'clients.purgeError': 'Error al purgar usuario revocado',
        'clients.createNetworkError': 'Error de conexión.',
        'clients.revokeNetworkError': 'Error de red al revocar usuario',
        'clients.purgeNetworkError': 'Error de red al purgar usuario revocado',
        'clients.purgeConfirm': "¿Purgar definitivamente a '{name}' de los registros de Easy-RSA?",
        'filters.all': 'Todos',
        'filters.connected': 'Conectados',
        'filters.active': 'Habilitados',
        'filters.revoked': 'Revocados',
        'table.user': 'Usuario',
        'table.status': 'Estado',
        'table.virtualIp': 'IP Virtual',
        'table.publicIp': 'IP Pública',
        'table.traffic': 'Tráfico Recibido/Enviado',
        'table.connectionExpiration': 'Conexión / Expiración',
        'table.actions': 'Acciones',
        'badges.connected': 'Conectado',
        'badges.enabled': 'Habilitado',
        'badges.revoked': 'Revocado',
        'date.expiration': 'Expiración:',
        'date.revokedOn': 'Revocado el:',
        'date.connected': 'Conectado:',
        'modal.createTitle': 'Crear Nuevo Usuario',
        'modal.createDesc': 'El script generará una nueva clave criptográfica y compilará el perfil de configuración (.ovpn) correspondiente.',
        'modal.clientName': 'Nombre del Cliente',
        'modal.usernamePlaceholder': 'ej. juan_portatil',
        'modal.usernameTitle': 'Solo letras, números, guiones y guiones bajos.',
        'modal.usernameHint': 'Solo se admiten caracteres alfanuméricos, guiones y guiones bajos (sin espacios).',
        'modal.revokeTitle': 'Confirmar Revocación',
        'modal.revokeQuestionPrefix': '¿Estás seguro de que deseas revocar a',
        'modal.revokeDesc': 'Esta acción invalidará permanentemente su certificado SSL/TLS en el servidor. El usuario perderá la conexión de inmediato y no podrá volver a conectarse con este perfil. Se eliminará el archivo .ovpn.',
        'loading.creating': 'Creando...',
        'loading.revoking': 'Revocando...',
        'toast.notification': 'Notificación',
        'logout.closed': 'Sesión cerrada'
    }
};

// DOM Elements
const el = {
    loginContainer: document.getElementById('login-container'),
    dashboardContainer: document.getElementById('dashboard-container'),
    loginForm: document.getElementById('login-form'),
    passwordInput: document.getElementById('password'),
    loginError: document.getElementById('login-error'),
    errorMessage: document.getElementById('error-message'),
    logoutBtn: document.getElementById('logout-btn'),
    
    // Stats
    statService: document.getElementById('stat-service'),
    statServiceSub: document.getElementById('stat-service-sub'),
    statActive: document.getElementById('stat-active'),
    statCpu: document.getElementById('stat-cpu'),
    statRam: document.getElementById('stat-ram'),
    serverStatusDot: document.getElementById('server-status-dot'),
    serverStatusText: document.getElementById('server-status-text'),
    
    // Clients Table
    clientsTableBody: document.getElementById('clients-table-body'),
    clientSearch: document.getElementById('client-search'),
    filterTabs: document.querySelectorAll('.filter-tab'),
    
    // Modals
    createModal: document.getElementById('create-modal'),
    btnOpenCreateModal: document.getElementById('btn-open-create-modal'),
    btnCloseCreateModal: document.getElementById('btn-close-create-modal'),
    btnCancelCreateModal: document.getElementById('btn-cancel-create-modal'),
    createUserForm: document.getElementById('create-user-form'),
    newUsernameInput: document.getElementById('new-username'),
    createError: document.getElementById('create-error'),
    createErrorMessage: document.getElementById('create-error-message'),
    btnSubmitCreateUser: document.getElementById('btn-submit-create-user'),
    
    revokeModal: document.getElementById('revoke-modal'),
    btnCloseRevokeModal: document.getElementById('btn-close-revoke-modal'),
    btnCancelRevokeModal: document.getElementById('btn-cancel-revoke-modal'),
    btnConfirmRevoke: document.getElementById('btn-confirm-revoke'),
    revokeClientDisplay: document.getElementById('revoke-client-display'),
    
    // Toast
    toast: document.getElementById('toast'),
    toastIcon: document.getElementById('toast-icon'),
    toastMessage: document.getElementById('toast-message')
};

// Boot / Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeLanguage();
    checkSession();
    setupEventListeners();
    lucide.createIcons();
});

function t(key) {
    return (i18n[state.language] && i18n[state.language][key]) || i18n.en[key] || key;
}

function tf(key, values = {}) {
    return t(key).replace(/\{(\w+)\}/g, (_, token) => values[token] ?? '');
}

function getLocale() {
    return state.language === 'es' ? 'es-CO' : 'en-US';
}

function initializeLanguage() {
    if (!i18n[state.language]) {
        state.language = 'en';
    }
    applyLanguage();
}

function setLanguage(language) {
    if (!i18n[language] || state.language === language) return;
    state.language = language;
    localStorage.setItem('ovpnmanager_language', language);
    applyLanguage();
    renderServiceStatus(state.serviceStatus);
    updateChartLanguage();
    renderClientsTable();
}

function applyLanguage() {
    document.documentElement.lang = state.language;
    document.title = t('app.title');

    document.querySelectorAll('[data-i18n]').forEach(node => {
        node.textContent = t(node.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
        node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
    });

    document.querySelectorAll('[data-i18n-title]').forEach(node => {
        node.setAttribute('title', t(node.dataset.i18nTitle));
    });

    document.querySelectorAll('[data-lang-option]').forEach(button => {
        const isActive = button.dataset.langOption === state.language;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

// Check Session on load
async function checkSession() {
    try {
        const res = await fetch('/api/auth/session');
        const data = await res.json();
        if (data.authenticated) {
            transitionToView('dashboard');
        } else {
            transitionToView('login');
        }
    } catch (err) {
        showToast(t('session.serverError'), 'error');
        transitionToView('login');
    }
}

// Switch screens with animation class handling
function transitionToView(viewName) {
    if (viewName === 'dashboard') {
        state.authenticated = true;
        el.loginContainer.classList.add('hidden');
        el.dashboardContainer.classList.remove('hidden');
        startPolling();
        initializeChart();
        refreshAllData();
    } else {
        state.authenticated = false;
        el.loginContainer.classList.remove('hidden');
        el.dashboardContainer.classList.add('hidden');
        stopPolling();
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
    }
    state.activeView = viewName;
    lucide.createIcons();
}

// Setup listeners
function setupEventListeners() {
    document.querySelectorAll('[data-lang-option]').forEach(button => {
        button.addEventListener('click', () => setLanguage(button.dataset.langOption));
    });

    // Login form submit
    el.loginForm.addEventListener('submit', handleLogin);
    
    // Logout button click
    el.logoutBtn.addEventListener('click', handleLogout);
    
    // Search filter
    el.clientSearch.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        renderClientsTable();
    });
    
    // Tab filters
    el.filterTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            el.filterTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.filter = tab.dataset.filter;
            renderClientsTable();
        });
    });
    
    // Modals visibility toggles
    el.btnOpenCreateModal.addEventListener('click', () => {
        el.createError.classList.add('hidden');
        el.createUserForm.reset();
        el.createModal.classList.remove('hidden');
        el.newUsernameInput.focus();
    });
    
    const closeCreate = () => el.createModal.classList.add('hidden');
    el.btnCloseCreateModal.addEventListener('click', closeCreate);
    el.btnCancelCreateModal.addEventListener('click', closeCreate);
    
    const closeRevoke = () => el.revokeModal.classList.add('hidden');
    el.btnCloseRevokeModal.addEventListener('click', closeRevoke);
    el.btnCancelRevokeModal.addEventListener('click', closeRevoke);
    
    // Form submits
    el.createUserForm.addEventListener('submit', handleCreateUser);
    el.btnConfirmRevoke.addEventListener('click', handleRevokeUser);
}

// Event Handlers
async function handleLogin(e) {
    e.preventDefault();
    const password = el.passwordInput.value;
    
    el.loginError.classList.add('hidden');
    
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            el.passwordInput.value = '';
            showToast(t('login.success'), 'success');
            transitionToView('dashboard');
        } else {
            el.errorMessage.textContent = data.error || t('login.badPassword');
            el.loginError.classList.remove('hidden');
        }
    } catch (err) {
        el.errorMessage.textContent = t('login.backendError');
        el.loginError.classList.remove('hidden');
    }
}

async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        showToast(t('logout.closed'), 'info');
        transitionToView('login');
    } catch (err) {
        transitionToView('login');
    }
}

async function handleCreateUser(e) {
    e.preventDefault();
    const name = el.newUsernameInput.value.trim();
    
    el.createError.classList.add('hidden');
    setLoadingState(el.btnSubmitCreateUser, true, t('loading.creating'));
    
    try {
        const res = await fetch('/api/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            showToast(tf('clients.created', { name }), 'success');
            el.createModal.classList.add('hidden');
            refreshAllData();
        } else {
            el.createErrorMessage.textContent = data.error || t('clients.createError');
            el.createError.classList.remove('hidden');
        }
    } catch (err) {
        el.createErrorMessage.textContent = t('clients.createNetworkError');
        el.createError.classList.remove('hidden');
    } finally {
        setLoadingState(el.btnSubmitCreateUser, false, t('actions.generateProfile'));
    }
}

function confirmRevoke(clientName) {
    state.selectedClientToRevoke = clientName;
    el.revokeClientDisplay.textContent = clientName;
    el.revokeModal.classList.remove('hidden');
}

async function handleRevokeUser() {
    const name = state.selectedClientToRevoke;
    if (!name) return;
    
    setLoadingState(el.btnConfirmRevoke, true, t('loading.revoking'));
    
    try {
        const res = await fetch(`/api/clients/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            showToast(tf('clients.revoked', { name }), 'success');
            el.revokeModal.classList.add('hidden');
            refreshAllData();
        } else {
            showToast(data.error || t('clients.revokeError'), 'error');
        }
    } catch (err) {
        showToast(t('clients.revokeNetworkError'), 'error');
    } finally {
        setLoadingState(el.btnConfirmRevoke, false, t('actions.revokeAccess'));
        state.selectedClientToRevoke = null;
    }
}

async function purgeRevokedClient(clientName) {
    const confirmed = window.confirm(tf('clients.purgeConfirm', { name: clientName }));
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/clients/${encodeURIComponent(clientName)}/purge`, {
            method: 'POST'
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast(tf('clients.purged', { name: clientName }), 'success');
            refreshAllData();
        } else {
            showToast(data.error || t('clients.purgeError'), 'error');
        }
    } catch (err) {
        showToast(t('clients.purgeNetworkError'), 'error');
    }
}

// Download profile configuration file
function downloadProfile(clientName) {
    window.location.href = `/api/clients/${encodeURIComponent(clientName)}/download`;
}

// Polling triggers
function startPolling() {
    stopPolling(); // Clear existing
    
    // Status metrics every 5s
    state.statusPollInterval = setInterval(fetchStatusMetrics, 5000);
    // Client lists every 5s
    state.clientsPollInterval = setInterval(fetchClients, 5000);
    // Bandwidth every 2s
    state.bandwidthPollInterval = setInterval(updateBandwidthChart, 2000);
}

function stopPolling() {
    if (state.statusPollInterval) clearInterval(state.statusPollInterval);
    if (state.clientsPollInterval) clearInterval(state.clientsPollInterval);
    if (state.bandwidthPollInterval) clearInterval(state.bandwidthPollInterval);
    
    state.statusPollInterval = null;
    state.clientsPollInterval = null;
    state.bandwidthPollInterval = null;
}

// Fetch all metrics immediately
function refreshAllData() {
    fetchStatusMetrics();
    fetchClients();
    updateBandwidthChart();
}

// REST Client requests
async function fetchStatusMetrics() {
    try {
        const res = await fetch('/api/status');
        if (res.status === 401 || res.status === 403) {
            transitionToView('login');
            return;
        }
        const data = await res.json();
        
        // Render system service status
        renderServiceStatus(data.openvpnActive ? 'online' : 'offline');
        
        el.statActive.textContent = data.activeConnectionsCount;
        el.statCpu.textContent = `${data.cpuLoad}%`;
        el.statRam.textContent = `${data.ramUsage}%`;
        
    } catch (err) {
        console.error('Error fetching system metrics:', err);
        renderServiceStatus('unreachable');
        el.statActive.textContent = '0';
        el.statCpu.textContent = '—';
        el.statRam.textContent = '—';
    }
}

function renderServiceStatus(status) {
    state.serviceStatus = status;

    if (status === 'detecting') {
        el.statService.textContent = t('status.detecting');
        el.statService.className = '';
        el.statServiceSub.textContent = t('status.serviceDetectingSub');
        el.serverStatusDot.className = 'status-dot offline';
        el.serverStatusText.textContent = t('status.detecting');
        return;
    }

    if (status === 'online') {
        el.statService.textContent = t('status.active');
        el.statService.className = 'text-glow-success';
        el.statServiceSub.textContent = t('status.serviceOnlineSub');
        el.serverStatusDot.className = 'status-dot online';
        el.serverStatusText.textContent = t('status.online');
        return;
    }

    if (status === 'unreachable') {
        el.statService.textContent = t('status.unreachable');
        el.statService.className = 'text-glow-danger';
        el.statServiceSub.textContent = t('status.serviceUnreachableSub');
        el.serverStatusDot.className = 'status-dot offline';
        el.serverStatusText.textContent = t('status.offline');
        return;
    }

    el.statService.textContent = t('status.inactive');
    el.statService.className = 'text-glow-danger';
    el.statServiceSub.textContent = t('status.serviceOfflineSub');
    el.serverStatusDot.className = 'status-dot offline';
    el.serverStatusText.textContent = t('status.offline');
}

async function fetchClients() {
    try {
        const res = await fetch('/api/clients');
        if (res.status === 401 || res.status === 403) {
            transitionToView('login');
            return;
        }
        state.clients = await res.json();
        renderClientsTable();
    } catch (err) {
        console.error('Error fetching clients:', err);
    }
}

// Render Clients Grid/Table
function renderClientsTable() {
    if (!state.clients || state.clients.length === 0) {
        el.clientsTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-td">
                    <div class="empty-state">
                        <i data-lucide="info" class="empty-icon"></i>
                        <p>${t('clients.empty')}</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    // Filters
    const filtered = state.clients.filter(client => {
        // Text search match
        const matchesSearch = client.name.toLowerCase().includes(state.searchQuery);
        if (!matchesSearch) return false;

        // Tab selection match
        if (state.filter === 'connected') return client.connected;
        if (state.filter === 'active') return isActiveClient(client);
        if (state.filter === 'revoked') return isRevokedClient(client);
        
        return true; // "all"
    });

    if (filtered.length === 0) {
        el.clientsTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-td">
                    <p>${t('clients.noMatches')}</p>
                </td>
            </tr>
        `;
        return;
    }

    // Map table row elements
    const rowsHtml = filtered.map(client => {
        const displayName = escapeHtml(client.name);
        const clientArg = JSON.stringify(client.name);

        // Avatar classes
        let avatarClass = 'user-avatar';
        let statusBadge = '';
        
        if (client.connected) {
            avatarClass += ' user-avatar-connected';
            statusBadge = `<span class="badge badge-connected"><i data-lucide="zap" class="w-3 h-3"></i>${t('badges.connected')}</span>`;
        } else if (isActiveClient(client)) {
            statusBadge = `<span class="badge badge-active">${t('badges.enabled')}</span>`;
        } else {
            avatarClass += ' user-avatar-revoked';
            statusBadge = `<span class="badge badge-revoked">${t('badges.revoked')}</span>`;
        }

        const ipVirtual = client.connected ? escapeHtml(client.virtualIp || 'N/A') : '—';
        const ipPublica = client.connected ? escapeHtml((client.ip || '').split(':')[0] || 'N/A') : '—';
        
        // Human-readable traffic sizing
        const traffic = client.connected 
            ? `<span class="traffic-cell"><span class="traffic-in">↓ ${formatBytes(client.downloaded)}</span> / <span class="traffic-out">↑ ${formatBytes(client.uploaded)}</span></span>`
            : '—';

        // Date Display
        let dateLabel = t('date.expiration');
        let dateString = '—';
        if (isRevokedClient(client) && client.revocationDate) {
            dateLabel = t('date.revokedOn');
            dateString = new Date(client.revocationDate).toLocaleDateString(getLocale());
        } else if (client.connected && client.connectedSince) {
            dateLabel = t('date.connected');
            // Simple parsing of connection date string (e.g. "Mon Jun 15 16:00:00 2026")
            try {
                const connDate = new Date(client.connectedSince);
                dateString = connDate.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) + ' ' + connDate.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
            } catch(e) {
                dateString = client.connectedSince;
            }
        } else if (client.expirationDate) {
            dateString = new Date(client.expirationDate).toLocaleDateString(getLocale());
        }

        const isRevoked = isRevokedClient(client);
        const downloadDisabled = !client.hasConfigFile ? 'disabled' : '';
        const accountAction = isRevoked
            ? `<button class="action-btn action-btn-purge" onclick='purgeRevokedClient(${clientArg})' title="${t('actions.purgeUser')}">
                    <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
               </button>`
            : `<button class="action-btn action-btn-revoke" onclick='confirmRevoke(${clientArg})' title="${t('actions.revokeUser')}">
                    <i data-lucide="shield-x" style="width: 15px; height: 15px;"></i>
               </button>`;

        return `
            <tr>
                <td data-label="${t('table.user')}">
                    <div class="user-cell">
                        <div class="${avatarClass}">
                            <i data-lucide="${client.connected ? 'zap' : isRevoked ? 'shield-x' : 'user'}" style="width: 16px; height: 16px;"></i>
                        </div>
                        <span class="user-name">${displayName}</span>
                    </div>
                </td>
                <td data-label="${t('table.status')}">${statusBadge}</td>
                <td data-label="${t('table.virtualIp')}">${ipVirtual}</td>
                <td data-label="${t('table.publicIp')}">${ipPublica}</td>
                <td data-label="${t('table.traffic')}">${traffic}</td>
                <td data-label="${t('table.connectionExpiration')}">
                    <span class="text-muted text-xs block">${dateLabel}</span>
                    <span>${dateString}</span>
                </td>
                <td data-label="${t('table.actions')}" class="text-center">
                    <div class="action-buttons">
                        <button class="action-btn action-btn-download" ${downloadDisabled} onclick='downloadProfile(${clientArg})' title="${t('actions.downloadProfile')}">
                            <i data-lucide="download" style="width: 15px; height: 15px;"></i>
                        </button>
                        ${accountAction}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    el.clientsTableBody.innerHTML = rowsHtml;
    lucide.createIcons();
}

// Chart.js initialization
function initializeChart() {
    const canvas = document.getElementById('bandwidth-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Background fills
    const gradientRx = ctx.createLinearGradient(0, 0, 0, 220);
    gradientRx.addColorStop(0, 'rgba(6, 182, 212, 0.2)');
    gradientRx.addColorStop(1, 'rgba(6, 182, 212, 0)');
    
    const gradientTx = ctx.createLinearGradient(0, 0, 0, 220);
    gradientTx.addColorStop(0, 'rgba(139, 92, 246, 0.2)');
    gradientTx.addColorStop(1, 'rgba(139, 92, 246, 0)');

    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: t('bandwidth.download'),
                    data: [],
                    borderColor: '#06b6d4',
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: gradientRx,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 8
                },
                {
                    label: t('bandwidth.upload'),
                    data: [],
                    borderColor: '#8b5cf6',
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: gradientTx,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0 // Disable line animations for smooth updates
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Outfit', size: 10 },
                        maxTicksLimit: 8
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.04)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Outfit', size: 10 },
                        callback: function(value) {
                            return formatSpeed(value);
                        }
                    },
                    min: 0
                }
            },
            plugins: {
                legend: {
                    display: false // We use our own customized HTML legend
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.85)',
                    titleColor: '#f8fafc',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    titleFont: { family: 'Outfit', weight: 'bold' },
                    bodyFont: { family: 'Outfit' },
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatSpeed(context.parsed.y);
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function updateChartLanguage() {
    if (!state.chart) return;
    state.chart.data.datasets[0].label = t('bandwidth.download');
    state.chart.data.datasets[1].label = t('bandwidth.upload');
    state.chart.update();
}

// Update live bandwidth chart metrics
async function updateBandwidthChart() {
    if (!state.chart || !state.authenticated) return;
    
    try {
        const res = await fetch('/api/bandwidth-history');
        if (res.status === 401 || res.status === 403) {
            transitionToView('login');
            return;
        }
        const data = await res.json();
        
        if (data && data.length > 0) {
            // Extract arrays for chart feeding
            const labels = data.map(item => item.time);
            const rxData = data.map(item => item.rx);
            const txData = data.map(item => item.tx);
            
            // Assign to chart datasets
            state.chart.data.labels = labels;
            state.chart.data.datasets[0].data = rxData;
            state.chart.data.datasets[1].data = txData;
            
            state.chart.update();
        }
    } catch (err) {
        console.error('Error fetching bandwidth history:', err);
    }
}

// UI Helper: formatting byte quantities
function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// UI Helper: formatting speeds
function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeClientStatus(client) {
    return String(client && client.status ? client.status : '').trim().toLowerCase();
}

function isActiveClient(client) {
    return normalizeClientStatus(client) === 'active';
}

function isRevokedClient(client) {
    const status = normalizeClientStatus(client);
    return status === 'revoked' || status === 'revocado';
}

// Loading indicator controller
function setLoadingState(buttonEl, isLoading, text) {
    const span = buttonEl.querySelector('span');
    const icon = buttonEl.querySelector('i');
    
    if (isLoading) {
        buttonEl.disabled = true;
        if (span) span.textContent = text;
        if (icon) icon.className = 'animate-spin'; // uses CSS rotation animation if added, or just hide
        buttonEl.style.opacity = '0.7';
    } else {
        buttonEl.disabled = false;
        if (span) span.textContent = text;
        if (icon) icon.className = '';
        buttonEl.style.opacity = '1';
        lucide.createIcons();
    }
}

// Toast notification trigger
let toastTimeout;
function showToast(message, type = 'info') {
    clearTimeout(toastTimeout);
    
    // Set text
    el.toastMessage.textContent = message;
    
    // Clear styles
    el.toast.className = 'toast animate-fade-in';
    
    // Choose styling class and Lucide icon
    let iconName = 'info';
    if (type === 'success') {
        el.toast.classList.add('toast-success');
        iconName = 'check-circle';
    } else if (type === 'error') {
        el.toast.classList.add('toast-error');
        iconName = 'alert-triangle';
    } else {
        el.toast.classList.add('toast-info');
        iconName = 'info';
    }
    
    el.toastIcon.setAttribute('data-lucide', iconName);
    lucide.createIcons();
    
    // Show toast
    el.toast.classList.remove('hidden');
    
    // Auto hide
    toastTimeout = setTimeout(() => {
        el.toast.classList.add('hidden');
    }, 4000);
}
