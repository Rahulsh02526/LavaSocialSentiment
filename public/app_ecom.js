// ============================================================
// E-COM DATA VIEW
// ============================================================

let ecomSortKey = 'launch_date';
let ecomSortDir = 'desc';

function renderEcomView() {
  const el = document.getElementById('view-ecom');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">E-commerce Data</div>
        <div class="section-sub">Amazon + Flipkart — manually captured, refreshed periodically by you</div>
      </div>
      <button class="primary small" onclick="${isAdminLoggedIn() ? 'openAddCommentsPanel()' : 'promptAdminLoginRedirect()'}">${isAdminLoggedIn() ? '+ Add New Comments' : 'Admin Login Required'}</button>
    </div>

    <div class="notice">
      Scraping Amazon/Flipkart directly isn't reliable for me to do — that part stays on your manual capture process. Comments older than each model's 6-month window are kept but excluded from aggregate scoring (see the <b>Window</b> column).
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
              <th onclick="sortEcom('launch_price_inr')" style="cursor:pointer;">Launch Price</th>
              <th>Status</th>
              <th>Amazon</th>
              <th>Flipkart</th>
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
