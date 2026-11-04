// ============================================================
// E-COM DATA VIEW
// ============================================================

let ecomSortKey = 'launch_date';
let ecomSortDir = 'desc';

// ---- helper: format a date string as "4 Nov 2026" ----
function fmtDate(d) {
  if (!d) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

// ---- helper: format price with optional "as of DD MMM YYYY" timestamp ----
function priceWithDate(price, dateStr, source) {
  if (!price) return '–';
  const formatted = '₹' + Math.round(price).toLocaleString('en-IN');
  const dateLabel = dateStr ? `<div style="font-size:10px; color:var(--text-faint);">as of ${fmtDate(dateStr)}</div>` : '';
  // source badge: amazon = orange, flipkart = blue, manual = gray
  const srcColor = source === 'amazon' ? '#FF9900' : source === 'flipkart' ? '#2874F0' : 'var(--text-faint)';
  const srcLabel = source ? `<div style="font-size:10px; color:${srcColor}; font-weight:600;">${source === 'amazon' ? '● Amazon' : source === 'flipkart' ? '● Flipkart' : '● Manual'}</div>` : '';
  return `<div style="font-weight:600;">${formatted}</div>${srcLabel}${dateLabel}`;
}

function renderEcomView() {
  const el = document.getElementById('view-ecom');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">E-commerce Data</div>
        <div class="section-sub">Amazon + Flipkart — prices and reviews auto-updated daily by scraper</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        ${isAdminLoggedIn() ? `<button class="ghost small" onclick="toggleBulkUrlPanel()">⚙ Update E-com URLs</button>` : ''}
        <button class="primary small" onclick="${isAdminLoggedIn() ? 'openAddCommentsPanel()' : 'promptAdminLoginRedirect()'}">${isAdminLoggedIn() ? '+ Add New Comments' : 'Admin Login Required'}</button>
      </div>
    </div>

    <!-- Bulk URL Update panel (admin only) -->
    ${isAdminLoggedIn() ? `
    <div id="bulkUrlPanel" style="display:none;" class="panel" style="margin-bottom:14px;">
      <div class="panel-title">Update E-com URLs in Bulk</div>
      <p style="font-size:12px; color:var(--text-faint); margin-bottom:12px;">
        Upload a CSV or Excel with columns: <b>model_name, amazon_url, flipkart_url</b><br>
        Model name must exactly match the platform. Leave a URL blank to keep existing.
      </p>
      <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:200px;">
          <label>Upload CSV / XLSX</label>
          <input type="file" id="urlBulkFile" accept=".csv,.xlsx,.xls" onchange="previewUrlBulk(this)">
        </div>
        <button class="ghost small" onclick="downloadUrlTemplate()">↓ Download Template</button>
      </div>
      <div id="urlBulkPreview" style="margin-top:12px;"></div>
      <div id="urlBulkStatus" style="margin-top:8px;"></div>
    </div>` : ''}

    <div class="notice">
      Prices are auto-scraped daily from Amazon &amp; Flipkart (7 AM IST). "as of" date shows when the price was last captured.
      Add Amazon/Flipkart product URLs for a model using the <b>⚙ Update E-com URLs</b> button above.
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
              <th onclick="sortEcom('current_price_inr')" style="cursor:pointer;">Current ₹</th>
              <th>Status</th>
              <th>Amazon</th>
              <th>Flipkart</th>
              <th onclick="sortEcom('num_comments')" style="cursor:pointer;">Reviews</th>
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
    // Count from both manual comments and auto-scraped reviews
    const commentCount = STATE.comments.filter(c => c.model_id === p.model_id).length;
    const taggedCount = STATE.comments.filter(c => c.model_id === p.model_id && c.tag).length;
    const status = getLifecycleStatus(p);

    // Current price — prefer scraper data, fall back to manual current_price_inr
    const currentP = p.current_price_inr || p.launch_price_inr;
    // Source of current price: 'amazon' | 'flipkart' | null (manual)
    const priceSource = p.amazon_price && p.flipkart_price
      ? (p.amazon_price <= p.flipkart_price ? 'amazon' : 'flipkart')
      : p.amazon_price ? 'amazon'
      : p.flipkart_price ? 'flipkart'
      : null;

    // Price delta vs launch
    const launchP = p.launch_price_inr;
    const priceDiff = (launchP && currentP && currentP !== launchP) ? currentP - launchP : null;
    const diffColor = priceDiff === null ? '' : priceDiff > 0 ? 'var(--neg)' : 'var(--pos)';
    const diffStr = priceDiff !== null
      ? `<div style="font-size:10px; color:${diffColor};">${priceDiff > 0 ? '+' : ''}₹${Math.abs(priceDiff).toLocaleString('en-IN')}</div>`
      : '';

    return `
    <tr>
      <td class="model-name">
        <a href="#" onclick="event.preventDefault(); goToModel(${p.model_id})">${p.model}</a>
        ${!p.amazon_url && !p.flipkart_url && isAdminLoggedIn()
          ? `<div style="font-size:9px; color:var(--neg); margin-top:2px;">No e-com URLs set</div>` : ''}
      </td>
      <td style="font-size:12px;">${p.launch_date || '–'}</td>
      <td class="num">${launchP ? '₹'+Math.round(launchP).toLocaleString('en-IN') : '–'}</td>
      <td class="num" style="line-height:1.4;">
        ${priceWithDate(currentP, p.price_last_updated, priceSource)}
        ${diffStr}
      </td>
      <td>${lifecycleBadge(status)}</td>
      <td>${availBadge(p.amazon_available)}</td>
      <td>${availBadge(p.flipkart_available)}</td>
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

// ============================================================
// BULK E-COM URL UPDATE
// ============================================================

function toggleBulkUrlPanel() {
  const p = document.getElementById('bulkUrlPanel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

// Download a CSV template with all current model names pre-filled
function downloadUrlTemplate() {
  const header = 'model_name,amazon_url,flipkart_url';
  const rows = STATE.phones.map(p => `"${p.model.replace(/"/g,'""')}",,`);
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'SIP_EcomURLs_Template.csv';
  a.click();
}

// Parse uploaded file and show preview table before submitting
async function previewUrlBulk(input) {
  const file = input.files[0];
  if (!file) return;
  const preview = document.getElementById('urlBulkPreview');
  const status  = document.getElementById('urlBulkStatus');
  preview.innerHTML = '<div class="notice"><span class="spinner"></span> Reading file…</div>';
  status.innerHTML  = '';

  let rows = [];

  try {
    if (file.name.endsWith('.csv')) {
      // Parse CSV
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g,''));
      const nameIdx = headers.indexOf('model_name');
      const amzIdx  = headers.indexOf('amazon_url');
      const fkIdx   = headers.indexOf('flipkart_url');
      if (nameIdx === -1) { preview.innerHTML = '<div class="notice danger">Column "model_name" not found in CSV.</div>'; return; }
      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parse (handles quoted commas)
        const cols = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
        const clean = (s) => (s || '').replace(/^"|"$/g,'').trim();
        const model_name  = clean(cols[nameIdx]);
        const amazon_url  = clean(cols[amzIdx]);
        const flipkart_url = clean(cols[fkIdx]);
        if (model_name) rows.push({ model_name, amazon_url: amazon_url || null, flipkart_url: flipkart_url || null });
      }
    } else {
      // Parse XLSX using the SheetJS already loaded on the page
      if (typeof XLSX === 'undefined') { preview.innerHTML = '<div class="notice danger">SheetJS not loaded — use CSV instead.</div>'; return; }
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
      rows = data.map(r => {
        // Normalize header names
        const get = (...keys) => {
          for (const k of keys) {
            const found = Object.keys(r).find(h => h.trim().toLowerCase() === k);
            if (found && r[found]) return String(r[found]).trim();
          }
          return null;
        };
        return {
          model_name:   get('model_name','model'),
          amazon_url:   get('amazon_url','amazon') || null,
          flipkart_url: get('flipkart_url','flipkart') || null,
        };
      }).filter(r => r.model_name);
    }
  } catch (e) {
    preview.innerHTML = `<div class="notice danger">Parse error: ${e.message}</div>`;
    return;
  }

  if (!rows.length) {
    preview.innerHTML = '<div class="notice danger">No data rows found. Check column names: model_name, amazon_url, flipkart_url</div>';
    return;
  }

  // Match each row to a model in STATE.phones (fuzzy: trim + lowercase)
  const modelMap = {};
  STATE.phones.forEach(p => { modelMap[p.model.trim().toLowerCase()] = p; });

  const matched   = rows.filter(r => modelMap[r.model_name.trim().toLowerCase()]);
  const unmatched = rows.filter(r => !modelMap[r.model_name.trim().toLowerCase()]);

  window._pendingUrlRows = matched;

  preview.innerHTML = `
    <div style="font-size:12px; color:var(--text-faint); margin-bottom:8px;">
      ${matched.length} model(s) matched · ${unmatched.length} unmatched
      ${unmatched.length ? `<div style="color:var(--neg); font-size:11px; margin-top:4px;">Unmatched: ${unmatched.map(r=>escapeHtml(r.model_name)).join(', ')}</div>` : ''}
    </div>
    <div class="table-wrap" style="max-height:220px; overflow-y:auto; margin-bottom:10px;">
      <table>
        <thead><tr><th>Model</th><th>Amazon URL</th><th>Flipkart URL</th></tr></thead>
        <tbody>
          ${matched.map(r => `<tr>
            <td style="font-size:11px; font-weight:500;">${escapeHtml(r.model_name)}</td>
            <td style="font-size:10px; color:${r.amazon_url ? '#FF9900' : 'var(--border)'};">${r.amazon_url ? '✓ set' : '–'}</td>
            <td style="font-size:10px; color:${r.flipkart_url ? '#2874F0' : 'var(--border)'};">${r.flipkart_url ? '✓ set' : '–'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${matched.length ? `
    <div style="display:flex; gap:10px;">
      <button class="primary" onclick="submitUrlBulk()">✓ Save URLs for ${matched.length} Model(s)</button>
      <button class="ghost" onclick="document.getElementById('urlBulkPreview').innerHTML=''; window._pendingUrlRows=null;">Cancel</button>
    </div>` : ''}
  `;
}

// Submit the matched rows to the API
async function submitUrlBulk() {
  const rows = window._pendingUrlRows;
  if (!rows || !rows.length) return;
  const status = document.getElementById('urlBulkStatus');
  status.innerHTML = '<div class="notice"><span class="spinner"></span> Saving…</div>';

  try {
    const result = await apiPost('/api/models?action=update-ecom-urls', { rows });
    // Refresh STATE.phones to show updated URLs
    rows.forEach(r => {
      const phone = STATE.phones.find(p => p.model.trim().toLowerCase() === r.model_name.trim().toLowerCase());
      if (phone) {
        if (r.amazon_url)   phone.amazon_url   = r.amazon_url;
        if (r.flipkart_url) phone.flipkart_url = r.flipkart_url;
      }
    });
    window._pendingUrlRows = null;
    document.getElementById('urlBulkPreview').innerHTML = '';
    status.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos);">✓ ${result.message}</div>`;
    renderEcomTable();  // refresh table to remove "No e-com URLs" warnings
  } catch (e) {
    status.innerHTML = `<div class="notice danger">Error: ${e.message}</div>`;
  }
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
