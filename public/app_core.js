// public/app_core.js
// ============================================================
// SOCIAL INTELLIGENCE PLATFORM v0.5 (Vercel build) — Core
// Data now lives in Supabase via /api/* routes instead of window.storage.
// ============================================================

const STATE = {
  phones: [],
  specs: {},
  comments: [],
  videoMap: {},
  marketingAssets: {},
  fetchStatus: null,
  activeView: 'query',
  selectedModelId: null,
  loading: true,
};

const PARAMS = ['battery','camera_back','camera_front','display','performance','processor','storage','memory','looks','heating','sound','software','value','charging','wifi','nfc','overall'];
const PARAM_LABELS = {
  battery:'Battery', camera_back:'Rear Camera', camera_front:'Front Camera', display:'Display',
  performance:'Performance', processor:'Processor', storage:'Storage', memory:'RAM/Memory',
  looks:'Looks/Design', heating:'Heating', sound:'Sound', software:'Software', value:'Value for Money',
  charging:'Charging Speed', wifi:'WiFi', nfc:'NFC', overall:'Overall'
};
const PRICE_SEGMENT_LABELS = { budget:'Budget (<₹10K)', entry_mid:'Entry-Mid (₹10-15K)', mid:'Mid (₹15-20K)', upper_mid:'Upper-Mid (₹20-25K)', premium_mid:'Premium-Mid (₹25-30K)' };

// ---------- API helpers ----------
// These delegate to the authed_* helpers in auth.js, which attach whatever token
// (viewer or admin) is currently held in this browser tab. Every existing call site
// across the app stays unchanged — auth is enforced transparently underneath.
async function apiGet(path) { return authedGet(path); }
async function apiPost(path, body) { return authedPost(path, body); }
async function apiDelete(path) { return authedDelete(path); }

// ---------- Lifecycle logic (3-state: active / semi_active / frozen) ----------
function getLifecycleStatus(phone) {
  if (!phone.launch_date) return null;
  const launch = new Date(phone.launch_date + 'T00:00:00');
  const sentimentFrozen = phone.sentiment_frozen_at ? new Date(phone.sentiment_frozen_at + 'T00:00:00') : null;
  const priceFrozen = phone.price_frozen_at ? new Date(phone.price_frozen_at + 'T00:00:00') : null;
  const now = new Date();
  if (sentimentFrozen && now <= sentimentFrozen) return 'active';
  if (priceFrozen && now <= priceFrozen) return 'semi_active';
  return 'frozen';
}
function isSentimentTrackingOpen(phone) { return getLifecycleStatus(phone) === 'active'; }
function isWithinWindow(phone, dateStr) {
  if (!dateStr) return true;
  if (!phone.sentiment_frozen_at) return true;
  return new Date(dateStr + 'T00:00:00') <= new Date(phone.sentiment_frozen_at + 'T00:00:00');
}
function isWindowOpen(phone) { return isSentimentTrackingOpen(phone); }
function lifecycleBadge(status) {
  if (status === 'active') return '<span class="badge pos">Active</span>';
  if (status === 'semi_active') return '<span class="badge neu">Semi-active</span>';
  if (status === 'frozen') return '<span class="badge gray">Frozen</span>';
  return '<span class="badge gray">?</span>';
}
function isFiveG(spec) { return spec && spec.connectivity && !spec.connectivity.includes('4G only'); }
function getAssetsForModel(modelId) { return STATE.marketingAssets[modelId] || []; }

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function goToModel(modelId) {
  STATE.selectedModelId = modelId;
  document.querySelector('.tab[data-view="model"]').click();
}

// ---------- Init ----------
async function initApp() {
  loadAuthFromSession();
  if (!AUTH.viewerToken && !AUTH.adminToken) {
    showViewerGate();
    return;
  }

  const statusEl = document.getElementById('loadingStatus');
  document.getElementById('loadingScreen').style.display = 'flex';
  try {
    if (statusEl) statusEl.textContent = 'Loading data from Supabase...';
    const data = await apiGet('/api/data');
    STATE.phones = data.phones;
    STATE.specs = data.specs;
    STATE.comments = data.comments;
    STATE.videoMap = data.videoMap;
    STATE.marketingAssets = data.marketingAssets;

    if (statusEl) statusEl.textContent = 'Loading fetch status...';
    try { STATE.fetchStatus = await apiGet('/api/fetch-status'); } catch (e) { STATE.fetchStatus = null; }

    STATE.loading = false;
    document.getElementById('app').style.display = 'flex';
    document.getElementById('loadingScreen').style.display = 'none';

    renderTopbar();
    renderAll();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--neg);">Failed to load: ${escapeHtml(e.message)}</span><br><span style="font-size:11px; color:var(--text-faint);">Check that SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set correctly in Vercel, and that the schema + seed SQL have been run.</span>`;
  }
}

// ---------- Navigation ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.getAttribute('data-view');
      STATE.activeView = view;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      renderView(view);
    });
  });
}

function renderTopbar() {
  const taggedCount = STATE.comments.filter(c => c.tag).length;
  const activeCount = STATE.phones.filter(p => getLifecycleStatus(p) === 'active').length;
  const ecomCount = STATE.comments.filter(c => c.source === 'Amazon' || c.source === 'Flipkart').length;
  const ytCount = STATE.comments.filter(c => c.source === 'YouTube').length;
  const el = document.getElementById('topbarStats');
  el.innerHTML = `
    <div class="stat-chip"><span>Models</span><b>${STATE.phones.length}</b></div>
    <div class="stat-chip" title="Amazon + Flipkart reviews"><span>E-com</span><b>${ecomCount.toLocaleString('en-IN')}</b></div>
    <div class="stat-chip" title="YouTube comments"><span>YouTube</span><b>${ytCount.toLocaleString('en-IN')}</b></div>
    <div class="stat-chip"><span>Tagged</span><b>${taggedCount.toLocaleString('en-IN')}/${STATE.comments.length.toLocaleString('en-IN')}</b></div>
    <div class="stat-chip"><span>Active</span><b>${activeCount}/${STATE.phones.length}</b></div>
    <div class="stat-chip"><span>YT Covered</span><b>${STATE.fetchStatus ? STATE.fetchStatus.fully_covered : '–'}/${STATE.phones.length}</b></div>
    <div class="stat-chip">
      <span>Access</span>
      <b style="color:${isAdminLoggedIn()?'var(--pos)':'var(--text-faint)'};">${isAdminLoggedIn() ? 'Admin' : 'Viewer'}</b>
    </div>
    ${!isAdminLoggedIn() ? `<button class="small ghost" onclick="window.open('/admin.html','_blank')" style="margin-left:6px;">Admin Login</button>` : ''}
  `;
}

function renderAll() {
  renderTopbar();
  renderOverview();
  renderEcomView();
  renderYoutubeView();
  renderTaggingView();
  renderModelView();
  renderThemesView();
  renderQueryView();
  renderSpecsView();
  renderMatrixView();
  renderGapView();
}

function renderView(view) {
  renderTopbar();
  if (view === 'overview') renderOverview();
  if (view === 'ecom') renderEcomView();
  if (view === 'youtube') renderYoutubeView();
  if (view === 'tagging') renderTaggingView();
  if (view === 'model') renderModelView();
  if (view === 'themes') renderThemesView();
  if (view === 'query') renderQueryView();
  if (view === 'specs') renderSpecsView();
  if (view === 'matrix') renderMatrixView();
  if (view === 'gap') renderGapView();
}

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  initApp();
});
