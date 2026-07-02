// public/app_youtube.js
// ============================================================
// YOUTUBE VIEW (Vercel build)
// Fetching now happens server-side via the daily cron job (api/cron-youtube-fetch.js).
// This view shows progress and offers a manual "run now" trigger for the same job,
// useful right after deploy or if you don't want to wait for the next scheduled run.
// ============================================================

let ytManualTriggerBusy = false;

function renderYoutubeView() {
  const el = document.getElementById('view-youtube');
  const fs = STATE.fetchStatus;
  const mappedCount = Object.keys(STATE.videoMap).length;

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">YouTube Integration</div>
        <div class="section-sub">Runs automatically once a day via Vercel Cron — covers ~12 models per run, all 58 within about 5 days</div>
      </div>
    </div>

    <div class="notice">
      Fetching now happens server-side on a schedule, so you don't need to paste an API key or babysit this tab. The cron job runs once daily and works through un-mapped models first (search.list, 100 units each — capped at 90 calls/day), then pulls/refreshes comments for already-mapped models (commentThreads.list, 1 unit each). Your key lives in Vercel's environment variables, never in the browser.
    </div>

    <div class="grid-4" style="margin-bottom:18px;">
      <div class="kpi">
        <div class="kpi-label">Fully Covered</div>
        <div class="kpi-value">${fs ? fs.fully_covered : '–'}/${STATE.phones.length}</div>
        <div class="kpi-sub">video mapped + comments fetched</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Video Mapped</div>
        <div class="kpi-value">${mappedCount}/${STATE.phones.length}</div>
        <div class="kpi-sub">${fs ? fs.status_counts.pending : '–'} still pending search</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Search Calls Today</div>
        <div class="kpi-value">${fs ? fs.today.search_calls_used : '–'}/${fs ? fs.today.search_calls_cap : 90}</div>
        <div class="kpi-sub">resets midnight Pacific Time</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Units Used Today</div>
        <div class="kpi-value">${fs ? fs.today.units_used : '–'}/${fs ? fs.today.units_cap : 9000}</div>
        <div class="kpi-sub">of the shared 10,000/day pool</div>
      </div>
    </div>

    ${fs && fs.status_counts.error > 0 ? `<div class="notice warn">${fs.status_counts.error} model(s) hit an error on their last fetch attempt (e.g. comments disabled on the matched video). They'll be skipped until you investigate — check Vercel function logs for details.</div>` : ''}
    ${fs && fs.status_counts.no_video_found > 0 ? `<div class="notice warn">${fs.status_counts.no_video_found} model(s) had no YouTube review video found in search. These won't be retried automatically — likely very new or low-coverage launches.</div>` : ''}

    <div class="panel">
      <div class="panel-title">Manual Trigger</div>
      <div style="font-size:12.5px; color:var(--text-dim); margin-bottom:10px;">
        Runs the same job the daily cron runs, right now. Useful after first deploy, or if you want today's batch immediately instead of waiting for the scheduled time.
        ${!isAdminLoggedIn() ? '<br><span style="color:var(--neu);">Admin login required to trigger this.</span>' : ''}
      </div>
      <button class="primary" onclick="triggerManualFetch()" id="ytManualBtn" ${ytManualTriggerBusy?'disabled':''}>
        ${ytManualTriggerBusy ? '<span class="spinner"></span> Running...' : (isAdminLoggedIn() ? 'Run Fetch Batch Now' : 'Admin Login Required')}
      </button>
      <div id="ytManualResultBox" style="margin-top:14px;"></div>
    </div>

    <div class="panel">
      <div class="panel-title">Mapped Models</div>
      <div id="ytMappedList"></div>
    </div>
  `;
  renderYtMappedList();
}

async function triggerManualFetch() {
  if (!isAdminLoggedIn()) { promptAdminLoginRedirect(); return; }

  ytManualTriggerBusy = true;
  document.getElementById('ytManualBtn').disabled = true;
  document.getElementById('ytManualBtn').innerHTML = '<span class="spinner"></span> Running...';
  const resultBox = document.getElementById('ytManualResultBox');
  resultBox.innerHTML = '';

  try {
    const data = await apiGet('/api/cron-youtube-fetch');

    resultBox.innerHTML = `
      <div class="notice">${escapeHtml(data.message || 'Done.')}</div>
      ${data.log && data.log.length ? `<div style="font-size:12px; color:var(--text-dim); font-family:var(--mono); max-height:220px; overflow-y:auto; background:var(--panel-2); padding:10px; border-radius:6px;">${data.log.map(l => escapeHtml(l)).join('<br>')}</div>` : ''}
    `;

    // refresh data so the UI reflects what just happened
    STATE.fetchStatus = await apiGet('/api/fetch-status');
    const fresh = await apiGet('/api/data');
    STATE.phones = fresh.phones; STATE.comments = fresh.comments; STATE.videoMap = fresh.videoMap;
    renderTopbar();
    renderYoutubeView();
  } catch (e) {
    resultBox.innerHTML = `<div class="notice danger">Failed: ${escapeHtml(e.message)}</div>`;
  }
  ytManualTriggerBusy = false;
}

function renderYtMappedList() {
  const box = document.getElementById('ytMappedList');
  const entries = Object.entries(STATE.videoMap);
  if (!entries.length) {
    box.innerHTML = `<div class="empty-state"><div class="title">No models mapped yet</div><div class="desc">Run a fetch batch (manually or wait for the daily cron) to start mapping videos.</div></div>`;
    return;
  }
  box.innerHTML = entries.map(([modelId, v]) => {
    const phone = STATE.phones.find(p => p.model_id == modelId);
    const ytCommentCount = STATE.comments.filter(c => c.model_id == modelId && c.source === 'YouTube').length;
    const lastFetch = v.lastFetchedAt ? new Date(v.lastFetchedAt).toLocaleString() : 'never';
    return `
      <div class="model-card" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="model-card-name">${phone ? phone.model : modelId}</div>
          <div class="model-card-meta">${escapeHtml(v.title||'')} · ${escapeHtml(v.channel||'')} · last fetched: ${lastFetch}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge gray">${ytCommentCount} pulled</span>
          <a href="https://youtube.com/watch?v=${v.videoId}" target="_blank" style="font-size:11px;">View ↗</a>
        </div>
      </div>
    `;
  }).join('');
}
