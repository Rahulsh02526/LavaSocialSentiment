// public/auth.js
// Single login gate — user chooses Viewer or Admin on the same screen.
// Admin login gives full access without needing viewer password first.

const AUTH = {
  viewerToken: null,
  adminToken: null,
};

function loadAuthFromSession() {
  AUTH.viewerToken = sessionStorage.getItem('sip_viewer_token');
  AUTH.adminToken = sessionStorage.getItem('sip_admin_token');
}

function isAdminLoggedIn() {
  return !!AUTH.adminToken;
}

async function authedGet(path) {
  const token = AUTH.adminToken || AUTH.viewerToken;
  const r = await fetch(path, { headers: { 'x-auth-token': token || '' } });
  const data = await r.json();
  if (r.status === 401) { handleAuthExpired(); throw new Error(data.error || 'Session expired'); }
  if (!r.ok) throw new Error(data.error || `GET ${path} failed (${r.status})`);
  return data;
}

async function authedPost(path, body) {
  const token = AUTH.adminToken || AUTH.viewerToken;
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token || '' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (r.status === 401) { handleAuthExpired(); throw new Error(data.error || 'Session expired'); }
  if (!r.ok) throw new Error(data.error || `POST ${path} failed (${r.status})`);
  return data;
}

async function authedDelete(path) {
  const token = AUTH.adminToken || AUTH.viewerToken;
  const r = await fetch(path, { method: 'DELETE', headers: { 'x-auth-token': token || '' } });
  const data = await r.json();
  if (r.status === 401) { handleAuthExpired(); throw new Error(data.error || 'Session expired'); }
  if (!r.ok) throw new Error(data.error || `DELETE ${path} failed (${r.status})`);
  return data;
}

function handleAuthExpired() {
  sessionStorage.removeItem('sip_viewer_token');
  sessionStorage.removeItem('sip_admin_token');
  AUTH.viewerToken = null;
  AUTH.adminToken = null;
  showLoginGate('Your session expired — please log in again.');
}

// ── Single Login Gate — Viewer or Admin ──
function showViewerGate(message) {
  showLoginGate(message);
}

function showLoginGate(message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'none';

  let gate = document.getElementById('loginGate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'loginGate';
    gate.className = 'loading-screen';
    gate.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <span style="font-family:var(--mono); font-weight:700; color:var(--accent); font-size:28px;">SIP</span>
        <div style="font-size:13px; color:var(--text-dim); margin-top:4px;">Social Intelligence Platform</div>
      </div>

      <!-- TAB SWITCHER -->
      <div style="display:flex; gap:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:20px; width:280px;">
        <button id="tabViewer" onclick="switchLoginTab('viewer')"
          style="flex:1; padding:9px; font-size:13px; font-weight:600; background:var(--accent); color:#fff; border:none; cursor:pointer;">
          👤 Viewer
        </button>
        <button id="tabAdmin" onclick="switchLoginTab('admin')"
          style="flex:1; padding:9px; font-size:13px; font-weight:600; background:var(--panel); color:var(--text-dim); border:none; cursor:pointer; border-left:1px solid var(--border);">
          🔐 Admin
        </button>
      </div>

      <div style="width:280px;">
        <input type="password" id="loginPasswordInput" placeholder="Enter password" 
          style="width:100%; margin-bottom:10px; font-size:14px;">
        <button class="primary" id="loginSubmitBtn" style="width:100%; font-size:14px; padding:10px;">
          Enter as Viewer
        </button>
        <div id="loginGateError" style="color:var(--neg); font-size:12px; margin-top:8px; text-align:center;"></div>
        <div style="margin-top:12px; font-size:11px; color:var(--text-faint); text-align:center; line-height:1.5;">
          Viewer — read-only access to all insights<br>
          Admin — full access including data management
        </div>
      </div>
    `;
    document.body.appendChild(gate);

    document.getElementById('loginSubmitBtn').addEventListener('click', submitLogin);
    document.getElementById('loginPasswordInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') submitLogin();
    });
  }

  gate.style.display = 'flex';
  if (message) document.getElementById('loginGateError').textContent = message;
  document.getElementById('loginPasswordInput').value = '';
  document.getElementById('loginPasswordInput').focus();
}

let currentLoginMode = 'viewer';

function switchLoginTab(mode) {
  currentLoginMode = mode;
  const viewerBtn = document.getElementById('tabViewer');
  const adminBtn  = document.getElementById('tabAdmin');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const input     = document.getElementById('loginPasswordInput');

  if (mode === 'viewer') {
    viewerBtn.style.background = 'var(--accent)';
    viewerBtn.style.color = '#fff';
    adminBtn.style.background = 'var(--panel)';
    adminBtn.style.color = 'var(--text-dim)';
    submitBtn.textContent = 'Enter as Viewer';
    input.placeholder = 'Viewer password';
  } else {
    adminBtn.style.background = 'var(--accent)';
    adminBtn.style.color = '#fff';
    viewerBtn.style.background = 'var(--panel)';
    viewerBtn.style.color = 'var(--text-dim)';
    submitBtn.textContent = 'Enter as Admin';
    input.placeholder = 'Admin password';
  }
  document.getElementById('loginGateError').textContent = '';
  input.value = '';
  input.focus();
}

async function submitLogin() {
  const input   = document.getElementById('loginPasswordInput');
  const errBox  = document.getElementById('loginGateError');
  const btn     = document.getElementById('loginSubmitBtn');
  const password = input.value;
  if (!password) return;

  btn.disabled = true;
  errBox.textContent = '';

  try {
    if (currentLoginMode === 'admin') {
      // Try admin login
      const r = await fetch('/api/auth-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Incorrect admin password');

      sessionStorage.setItem('sip_admin_token', data.token);
      AUTH.adminToken = data.token;

    } else {
      // Try viewer login
      const r = await fetch('/api/auth-viewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Incorrect password');

      sessionStorage.setItem('sip_viewer_token', data.token);
      AUTH.viewerToken = data.token;
    }

    // Success — hide gate and load app
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('loadingScreen').style.display = 'flex';
    initApp();

  } catch (e) {
    errBox.textContent = e.message;
  }
  btn.disabled = false;
}

function promptAdminLoginRedirect() {
  showLoginGate('Admin access required for this action.');
  switchLoginTab('admin');
}
