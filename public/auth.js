// public/auth.js
// ============================================================
// CLIENT-SIDE AUTH — viewer gate (sessionStorage, dies on tab close) +
// admin login state (also sessionStorage, separate key, separate page).
// ============================================================

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

// Wraps fetch with the viewer token attached (every read route needs at least this).
// If an admin token exists, it's sent instead — admin tokens satisfy viewer checks too,
// so a logged-in admin never needs to separately hold a viewer token.
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
  showViewerGate('Your session expired — please re-enter the password.');
}

// ---------- Viewer gate ----------
function showViewerGate(message) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('loadingScreen').style.display = 'none';
  let gate = document.getElementById('viewerGate');
  if (!gate) {
    gate = document.createElement('div');
    gate.id = 'viewerGate';
    gate.className = 'loading-screen';
    gate.innerHTML = `
      <span class="brand-mark" style="font-family: var(--mono); font-weight: 700; color: var(--accent); font-size: 24px;">SIP</span>
      <div style="font-size: 14px; color: var(--text-dim); margin-bottom: 6px;">Social Intelligence Platform</div>
      <div style="width: 260px;">
        <input type="password" id="viewerPasswordInput" placeholder="Dashboard password" style="width:100%; margin-bottom:10px;">
        <button class="primary" id="viewerLoginBtn" style="width:100%;">Enter</button>
        <div id="viewerGateError" style="color: var(--neg); font-size: 12px; margin-top: 8px; text-align:center;"></div>
      </div>
    `;
    document.body.appendChild(gate);
    document.getElementById('viewerLoginBtn').addEventListener('click', submitViewerPassword);
    document.getElementById('viewerPasswordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitViewerPassword(); });
  }
  gate.style.display = 'flex';
  if (message) document.getElementById('viewerGateError').textContent = message;
  document.getElementById('viewerPasswordInput').focus();
}

async function submitViewerPassword() {
  const input = document.getElementById('viewerPasswordInput');
  const errBox = document.getElementById('viewerGateError');
  const btn = document.getElementById('viewerLoginBtn');
  const password = input.value;
  if (!password) return;

  btn.disabled = true;
  errBox.textContent = '';
  try {
    const r = await fetch('/api/auth-viewer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Login failed');

    sessionStorage.setItem('sip_viewer_token', data.token);
    AUTH.viewerToken = data.token;
    document.getElementById('viewerGate').style.display = 'none';
    document.getElementById('loadingScreen').style.display = 'flex';
    initApp();
  } catch (e) {
    errBox.textContent = e.message;
  }
  btn.disabled = false;
}

// Called by any UI action that requires admin rights but the user isn't logged in as admin yet.
function promptAdminLoginRedirect() {
  if (confirm('This action requires admin login. Open the admin login page in a new tab?')) {
    window.open('/admin.html', '_blank');
  }
}

// admin.html pushes the token here directly via postMessage once login succeeds, since
// sessionStorage itself does not sync between tabs (each tab has its own isolated copy).
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === 'sip_admin_login' && event.data.token) {
    AUTH.adminToken = event.data.token;
    sessionStorage.setItem('sip_admin_token', event.data.token);
    if (typeof renderTopbar === 'function') renderTopbar();
    if (typeof renderView === 'function' && typeof STATE !== 'undefined') renderView(STATE.activeView);
  }
});
