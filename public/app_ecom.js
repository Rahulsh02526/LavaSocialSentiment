// ============================================================
// E-COM DATA VIEW
// ============================================================

let ecomSortKey = 'launch_date';
let ecomSortDir = 'desc';
let ecomFetchBusy = false;
let ecomAutoRunning = false;
let ecomRunCount = 0;
const ECOM_AUTO_MAX = 25; // safety cap — max 25 auto-runs per session (~125 models)

function renderEcomView() {
  const el = document.getElementById('view-ecom');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">E-commerce Data</div>
        <div class="section-sub">Amazon + Flipkart — prices auto-fetched daily, comments manually captured</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${isAdminLoggedIn() ? `
          <button id="ecomFetchBtn" class="small" onclick="startEcomAutoFetch(false)" title="Fetch latest prices — auto-continues until all models done">🔄 Run Price Fetch Now</button>
          <button id="ecomForceFetchBtn" class="small" onclick="startEcomAutoFetch(true)" title="Force re-fetch all models even if done today" style="color:var(--text-dim);">⚡ Force Fetch All</button>
          <button id="ecomFetchStopBtn" style="display:none;" class="small danger" onclick="stopEcomFetch()">■ Stop</button>
        ` : ''}
        <button class="primary small" onclick="${isAdminLoggedIn() ? 'openAddCommentsPanel()' : 'promptAdminLoginRedirect()'}">${isAdminLoggedIn() ? '+ Add Comments' : 'Admin Login Required'}</button>
      </div>
    </div>

    <div id="ecomFetchResultBox" style="margin-bottom:12px;"></div>

    <div class="notice">
      Prices are fetched daily from Amazon/Flipkart (models with URLs set). Click <b>Run Price Fetch Now</b> to trigger immediately. Comments older than each model's 6-month window are kept but excluded from aggregate scoring (see the <b>Window</b> column).
    </div>

    <div id="addCommentsPanel" style="display:none;" class="panel">
      <div class="panel-title">Add New Comments / Reviews</div>
      <div class="field">
        <label>Model</label>
        <select id="newCommentModel">
          ${STATE.phones.map(p => `<option value="${p.model_id}">${p.model}</option>`).join('')}
        </select>
      </div>
      <div class="field-row" style="margin-bottom:12px;">
        <div class="field">
          <label>Source</label>
          <select id="newCommentSource">
            <option value="Amazon">Amazon</option>
            <option value="Flipkart">Flipkart</option>
          </select>
        </div>
        <div class="field">
          <label>Comment Date (optional — used for window check)</label>
          <input type="date" id="newCommentDate">
        </div>
      </div>
      <div class="field">
        <label>Paste comments (one per line)</label>
        <textarea id="newCommentText" rows="6" placeholder="Paste review text, one comment per line..."></textarea>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="primary" onclick="submitNewComments()">Add Comments</button>
        <button class="ghost" onclick="closeAddCommentsPanel()">Cancel</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">All Models (${STATE.phones.length})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th onclick="sortEcom('model')" style="cursor:pointer;">Model</th>
              <th onclick="sortEcom('launch_date')" style="cursor:pointer;">Launch Date</th>
              <th onclick="sortEcom('launch_price_inr')" style="cursor:pointer;">Launch ₹</th>
              <th onclick="sortEcom('amazon_price')" style="cursor:pointer;" title="Latest Amazon price">Amazon ₹</th>
              <th onclick="sortEcom('flipkart_price')" style="cursor:pointer;" title="Latest Flipkart price">Flipkart ₹</th>
              <th>Status</th>
              <th>Amazon</th>
              <th>Flipkart</th>
              <th onclick="sortEcom('price_last_updated')" style="cursor:pointer;" title="Last price fetch date">Updated</th>
              <th onclick="sortEcom('num_comments')" style="cursor:pointer;">Comments</th>
              <th>Tagged</th>
            </tr>
          </thead>
          <tbody id="ecomTbody"></tbody>
        </table>
      </div>
    </div>
  `;
  renderEcomTable();
}

function renderEcomTable() {
  const tbody = document.getElementById('ecomTbody');
  if (!tbody) return;
  let rows = [...STATE.phones];
  if (ecomSortKey === 'num_comments') {
    rows.sort((a,b) => {
      const av = STATE.comments.filter(c => c.model_id === a.model_id).length;
      const bv = STATE.comments.filter(c => c.model_id === b.model_id).length;
      return ecomSortDir === 'asc' ? av - bv : bv - av;
    });
  } else {
  rows.sort((a,b) => {
    let av = a[ecomSortKey], bv = b[ecomSortKey];
    if (av == null) av = ecomSortDir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = ecomSortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv||'').toLowerCase(); }
    if (av < bv) return ecomSortDir === 'asc' ? -1 : 1;
    if (av > bv) return ecomSortDir === 'asc' ? 1 : -1;
    return 0;
  });
  }

  tbody.innerHTML = rows.map(p => {
    const commentCount = STATE.comments.filter(c => c.model_id === p.model_id).length;
    const taggedCount = STATE.comments.filter(c => c.model_id === p.model_id && c.tag).length;
    const status = getLifecycleStatus(p);
    return `
    <tr>
      <td class="model-name"><a href="#" onclick="event.preventDefault(); goToModel(${p.model_id})">${p.model}</a></td>
      <td>${p.launch_date || '–'}</td>
      <td class="num">${p.launch_price_inr ? '₹'+Math.round(p.launch_price_inr).toLocaleString('en-IN') : '–'}</td>
      <td class="num">${(() => {
        // Amazon price cell — show price + diff vs launch
        if (!p.amazon_price) return '<span style="color:var(--text-faint);">–</span>';
        const curr = Math.round(p.amazon_price);
        const launch = Math.round(p.launch_price_inr || 0);
        const diff = curr - launch;
        const diffStr = launch && diff !== 0 ? `<br><span style="font-size:10px; color:${diff > 0 ? 'var(--neg)' : 'var(--pos)'};">${diff > 0 ? '+' : '–'}₹${Math.abs(diff).toLocaleString('en-IN')}</span>` : '';
        return '₹'+curr.toLocaleString('en-IN') + diffStr;
      })()}</td>
      <td class="num">${(() => {
        // Flipkart price cell — show price + diff vs launch
        if (!p.flipkart_price) return '<span style="color:var(--text-faint);">–</span>';
        const curr = Math.round(p.flipkart_price);
        const launch = Math.round(p.launch_price_inr || 0);
        const diff = curr - launch;
        const diffStr = launch && diff !== 0 ? `<br><span style="font-size:10px; color:${diff > 0 ? 'var(--neg)' : 'var(--pos)'};">${diff > 0 ? '+' : '–'}₹${Math.abs(diff).toLocaleString('en-IN')}</span>` : '';
        return '₹'+curr.toLocaleString('en-IN') + diffStr;
      })()}</td>
      <td>${lifecycleBadge(status)}</td>
      <td>${availBadge(p.amazon_available)}</td>
      <td>${availBadge(p.flipkart_available)}</td>
      <td style="font-size:11px; color:var(--text-dim);">${p.price_last_updated || '–'}</td>
      <td class="num">${commentCount}</td>
      <td class="num">${taggedCount}/${commentCount}</td>
    </tr>`;
  }).join('');
}

function availBadge(v) {
  if (v === 'Yes') return '<span class="badge pos">Yes</span>';
  if (v === 'No') return '<span class="badge neg">No</span>';
  return '<span class="badge gray">?</span>';
}

function sortEcom(key) {
  if (ecomSortKey === key) ecomSortDir = ecomSortDir === 'asc' ? 'desc' : 'asc';
  else { ecomSortKey = key; ecomSortDir = 'desc'; }
  renderEcomTable();
}

function openAddCommentsPanel() { document.getElementById('addCommentsPanel').style.display = 'block'; }
function closeAddCommentsPanel() { document.getElementById('addCommentsPanel').style.display = 'none'; }

// ---- E-com Price Fetch (mirrors YT triggerManualFetch pattern) ----------

async function triggerEcomFetch(force = false, autoRun = false) {
  if (!isAdminLoggedIn()) { promptAdminLoginRedirect(); return; }
  if (ecomFetchBusy) return;

  ecomFetchBusy = true;
  const btn      = document.getElementById('ecomFetchBtn');
  const forceBtn = document.getElementById('ecomForceFetchBtn');
  const stopBtn  = document.getElementById('ecomFetchStopBtn');
  const resultBox = document.getElementById('ecomFetchResultBox');

  // On first run: clear log, reset counter
  if (!autoRun) { resultBox.innerHTML = ''; ecomRunCount = 0; }

  if (btn)      { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Fetching... ${ecomRunCount > 0 ? '('+ecomRunCount+' done)' : ''}`; }
  if (forceBtn) { forceBtn.disabled = true; }
  if (stopBtn)  { stopBtn.style.display = 'inline-block'; }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 65000); // 65s — just over Vercel's 60s limit

  try {
    const url = '/api/prices?action=scrape' + (force ? '&force=true' : '');
    const resp = await fetch(url, {
      headers: { 'x-auth-token': AUTH.adminToken || '' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await resp.json();
    ecomRunCount++;

    // Append result log (prepend so latest is on top)
    const entry = document.createElement('div');
    entry.style.cssText = 'margin-bottom:6px;';
    entry.innerHTML = `
      <div class="notice" style="margin-bottom:4px; border-color:${data.pending > 0 ? 'var(--accent)' : 'var(--pos)'};">
        ${escapeHtml(data.message || 'Done.')}
      </div>
      ${data.log?.length ? `<div style="font-size:11px; color:var(--text-dim); font-family:var(--mono); background:var(--panel-2); padding:8px 10px; border-radius:6px; line-height:1.7;">${data.log.map(l => escapeHtml(l)).join('<br>')}</div>` : ''}
    `;
    resultBox.prepend(entry);

    // Refresh prices in STATE so table updates immediately
    if (data.updated > 0) {
      try {
        const fresh = await apiGet('/api/data');
        STATE.phones = fresh.phones;
        STATE.comments = fresh.comments;
        renderTopbar();
        renderEcomTable();
      } catch (_) { /* refresh failed — not critical */ }
    }

    // Auto-continue if more pending and not stopped and under safety cap
    if (data.pending > 0 && ecomAutoRunning && ecomRunCount < ECOM_AUTO_MAX) {
      if (btn) btn.innerHTML = `<span class="spinner"></span> Fetching... (${ecomRunCount} done, ${data.pending} pending)`;
      ecomFetchBusy = false;
      setTimeout(() => triggerEcomFetch(force, true), 2000); // 2s pause between batches
      return;
    } else {
      // All done or stopped
      ecomAutoRunning = false;
      if (ecomRunCount > 1) {
        const summary = document.createElement('div');
        summary.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos); margin-bottom:8px;">✓ Completed ${ecomRunCount} batches — prices updated</div>`;
        resultBox.prepend(summary);
      }
    }

  } catch (e) {
    clearTimeout(timeoutId);
    ecomAutoRunning = false;
    const entry = document.createElement('div');
    entry.innerHTML = `<div class="notice danger">${e.name === 'AbortError' ? '⏱ Timed out — server may still be processing in the background.' : '✗ Failed: ' + escapeHtml(e.message)}</div>`;
    resultBox.prepend(entry);
  }

  ecomFetchBusy = false;
  ecomAutoRunning = false;
  if (btn)      { btn.disabled = false; btn.innerHTML = '🔄 Run Price Fetch Now'; }
  if (forceBtn) { forceBtn.disabled = false; }
  if (stopBtn)  { stopBtn.style.display = 'none'; }
}

function startEcomAutoFetch(force = false) {
  // Starts auto-continue loop — runs until all pending done or stopped
  if (ecomAutoRunning) return;
  ecomAutoRunning = true;
  ecomRunCount = 0;
  triggerEcomFetch(force, false);
}

function stopEcomFetch() {
  // Sets flag so next batch doesn't auto-trigger; can't cancel in-flight HTTP
  ecomAutoRunning = false;
  ecomFetchBusy = false;
  const stopBtn  = document.getElementById('ecomFetchStopBtn');
  const btn      = document.getElementById('ecomFetchBtn');
  const forceBtn = document.getElementById('ecomForceFetchBtn');
  const resultBox = document.getElementById('ecomFetchResultBox');
  if (stopBtn)  stopBtn.style.display = 'none';
  if (btn)      { btn.disabled = false; btn.innerHTML = '🔄 Run Price Fetch Now'; }
  if (forceBtn) forceBtn.disabled = false;
  const note = document.createElement('div');
  note.innerHTML = `<div class="notice warn" style="margin-bottom:8px;">⏹ Stopped — current batch will still complete on server.</div>`;
  resultBox.prepend(note);
}

async function submitNewComments() {
  const modelId = parseInt(document.getElementById('newCommentModel').value);
  const source = document.getElementById('newCommentSource').value;
  const commentDate = document.getElementById('newCommentDate').value || null;
  const raw = document.getElementById('newCommentText').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) { alert('Paste at least one comment.'); return; }

  try {
    const result = await apiPost('/api/comments', { model_id: modelId, source, comment_date: commentDate, texts: lines });
    const existingIds = new Set(STATE.comments.map(c => c.id));
    result.comments.forEach(c => {
      if (!existingIds.has(c.id)) { STATE.comments.push({ ...c, tag: null }); existingIds.add(c.id); }
    });

    const phone = STATE.phones.find(p => p.model_id === modelId);

    document.getElementById('newCommentText').value = '';
    closeAddCommentsPanel();
    renderTopbar();
    renderEcomTable();
    alert(`Added ${result.added} new comment(s)${result.added < result.attempted ? ` (${result.attempted - result.added} were duplicates and skipped)` : ''}. Go to Tagging Engine to tag them.`);
  } catch (e) {
    alert('Failed to add comments: ' + e.message);
  }
}
