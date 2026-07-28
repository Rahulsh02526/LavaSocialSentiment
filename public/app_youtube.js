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
  const btn = document.getElementById('ytManualBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Running...';
  const resultBox = document.getElementById('ytManualResultBox');
  resultBox.innerHTML = '';

  // 65 second timeout — slightly more than Vercel's 60s function limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 65000);

  try {
    const resp = await fetch('/api/cron-youtube-fetch', {
      headers: { 'x-auth-token': getAdminToken() },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await resp.json();

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
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      resultBox.innerHTML = `<div class="notice warn">Request timed out after 65 seconds — the server may still be processing. Refresh the page to see updated status.</div>`;
    } else {
      resultBox.innerHTML = `<div class="notice danger">Failed: ${escapeHtml(e.message)}</div>`;
    }
  }
  ytManualTriggerBusy = false;
  btn.disabled = false;
  btn.innerHTML = isAdminLoggedIn() ? 'Run Fetch Batch Now' : 'Admin Login Required';
}

function renderYtMappedList() {
  const box = document.getElementById('ytMappedList');
  const entries = Object.entries(STATE.videoMap);
  if (!entries.length) {
    box.innerHTML = `<div class="empty-state"><div class="title">No models mapped yet</div><div class="desc">Run a fetch batch (manually or wait for the daily cron) to start mapping videos.</div></div>`;
    return;
  }

  const totalMapped = entries.length;
  const totalYtComments = STATE.comments.filter(c => c.source === 'YouTube').length;

  box.innerHTML = `
    <div style="font-size:12px; color:var(--text-faint); margin-bottom:12px;">
      ${totalMapped} models mapped · ${totalYtComments.toLocaleString('en-IN')} total YT comments · Click any model to expand videos
    </div>
    ${entries.map(([modelId, videos]) => {
      const phone = STATE.phones.find(p => p.model_id == modelId);
      const ytCommentCount = STATE.comments.filter(c => c.model_id == modelId && c.source === 'YouTube').length;
      const officialVideo = Array.isArray(videos) ? videos.find(v => v.videoType === 'official') : null;
      const reviewerVideos = Array.isArray(videos) ? videos.filter(v => v.videoType === 'reviewer') : [];
      const totalVideos = Array.isArray(videos) ? videos.length : 0;
      const hasOfficial = !!officialVideo;
      const uid = 'ytm_' + modelId;

      return `
        <div style="border:1px solid var(--border); border-radius:6px; margin-bottom:6px; overflow:hidden;">
          <div onclick="toggleYtModel('${uid}')"
            style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; cursor:pointer; background:var(--panel);">
            <div style="display:flex; align-items:center; gap:12px;">
              <span id="${uid}_arrow" style="color:var(--text-faint); font-size:11px; transition:transform 0.15s;">▶</span>
              <div>
                <div style="font-weight:600; font-size:13px;">${phone ? phone.model : modelId}</div>
                <div style="font-size:11px; color:var(--text-faint); margin-top:2px;">
                  ${totalVideos} video${totalVideos===1?'':'s'}
                  ${hasOfficial ? '<span style="color:var(--pos); margin-left:6px;">✓ official</span>' : '<span style="color:var(--text-faint); margin-left:6px;">no official</span>'}
                  · ${ytCommentCount.toLocaleString('en-IN')} YT comments
                </div>
              </div>
            </div>
            <span class="badge gray">${totalVideos}</span>
          </div>
          <div id="${uid}_content" style="display:none; padding:8px 14px 10px; background:var(--panel-2); border-top:1px solid var(--border);">

            ${isAdminLoggedIn() ? `
            <div style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border); display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <button class="small primary" onclick="fetchVideoCandiates(${modelId})" id="findBtn_${modelId}">🔍 Find Videos (−150 units)</button>
              <button class="small" onclick="toggleManualUrlPanel(${modelId})">+ Manual URL</button>
              <span style="font-size:11px; color:var(--text-faint);">Fetches 20 candidates by relevance — you select which to keep</span>
            </div>
            <div id="manualUrlPanel_${modelId}" style="display:none; margin-bottom:10px; padding:10px; background:var(--panel); border-radius:6px;">
              <div style="font-size:12px; color:var(--text-dim); margin-bottom:6px;">Paste a YouTube URL to add it directly:</div>
              <div style="display:flex; gap:8px;">
                <input type="text" id="manualUrl_${modelId}" placeholder="https://youtube.com/watch?v=..." style="flex:1; font-size:12px;">
                <select id="manualUrlType_${modelId}" style="font-size:12px;">
                  <option value="reviewer">Reviewer</option>
                  <option value="official">Official</option>
                </select>
                <button class="small primary" onclick="addManualVideo(${modelId})">Add</button>
              </div>
            </div>
            <div id="candidateGrid_${modelId}"></div>
            ` : ''}

            ${officialVideo ? `
            <div style="padding:6px 10px; background:var(--panel); border-radius:4px; display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; border-left:3px solid var(--pos);">
              <div style="flex:1; min-width:0;">
                <span style="font-size:10px; color:var(--pos); font-weight:700; margin-right:6px;">OFFICIAL</span>
                <span style="font-size:12px;">${escapeHtml(officialVideo.title||'')}</span>
                <span style="font-size:11px; color:var(--text-faint);"> · ${escapeHtml(officialVideo.channel||'')}</span>
              </div>
              <a href="https://youtube.com/watch?v=${officialVideo.videoId}" target="_blank" style="font-size:11px; flex-shrink:0; margin-left:10px; color:var(--accent);">View ↗</a>
            </div>` : `
            <div style="padding:6px 10px; font-size:11px; color:var(--text-faint); margin-bottom:6px; font-style:italic;">No official brand video mapped — use Find Videos or Manual URL above</div>`}
            ${reviewerVideos.map((v, i) => `
            <div style="padding:5px 10px; border-radius:4px; display:flex; justify-content:space-between; align-items:center; ${i < reviewerVideos.length-1 ? 'border-bottom:1px solid var(--border);' : ''}">
              <div style="flex:1; min-width:0;">
                <span style="font-size:10px; color:var(--text-faint); font-weight:600; margin-right:6px;">REVIEWER</span>
                <span style="font-size:11px;">${escapeHtml(v.title||'')}</span>
                <span style="font-size:11px; color:var(--text-faint);"> · ${escapeHtml(v.channel||'')}</span>
              </div>
              <a href="https://youtube.com/watch?v=${v.videoId}" target="_blank" style="font-size:11px; flex-shrink:0; margin-left:10px; color:var(--accent);">View ↗</a>
            </div>`).join('')}
          </div>
        </div>
      `;
    }).join('')}
  `;
}

function toggleYtModel(uid) {
  const content = document.getElementById(uid + '_content');
  const arrow = document.getElementById(uid + '_arrow');
  if (!content) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'block';
  if (arrow) arrow.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function toggleManualUrlPanel(modelId) {
  const panel = document.getElementById('manualUrlPanel_' + modelId);
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// ---- Find Videos (thumbnail grid selection) ----
async function fetchVideoCandiates(modelId) {
  if (!isAdminLoggedIn()) { promptAdminLoginRedirect(); return; }
  const btn = document.getElementById('findBtn_' + modelId);
  const grid = document.getElementById('candidateGrid_' + modelId);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Fetching...'; }
  if (grid) grid.innerHTML = '';

  try {
    const data = await apiPost('/api/search-videos', { model_id: modelId });
    if (btn) { btn.disabled = false; btn.innerHTML = '🔍 Find Videos (−150 units)'; }

    if (!data.videos || data.videos.length === 0) {
      if (grid) grid.innerHTML = `<div style="padding:10px; font-size:12px; color:var(--text-faint);">No relevant India videos found. Use Manual URL to add videos directly.</div>`;
      return;
    }

    renderCandidateGrid(modelId, data.videos);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '🔍 Find Videos (−150 units)'; }
    if (grid) grid.innerHTML = `<div style="padding:10px; font-size:12px; color:var(--neg);">Error: ${escapeHtml(e.message)}</div>`;
  }
}

function formatViews(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M views';
  if (n >= 1000) return Math.round(n/1000) + 'K views';
  return n + ' views';
}

// store candidates in memory for save step
const candidateSelections = {}; // modelId -> { videos: [], selected: Set of video_ids }

function renderCandidateGrid(modelId, videos) {
  candidateSelections[modelId] = { videos, selected: new Set() };
  const grid = document.getElementById('candidateGrid_' + modelId);
  if (!grid) return;

  grid.innerHTML = `
    <div style="margin-bottom:10px; padding:10px; background:var(--panel); border-radius:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:12px; font-weight:600;">Select videos to map (max 10) — click to select, click again to deselect</div>
        <div style="display:flex; gap:6px;">
          <span id="selCount_${modelId}" style="font-size:11px; color:var(--text-faint);">0 selected</span>
          <button class="small primary" onclick="saveVideoSelection(${modelId})" id="saveSelBtn_${modelId}" disabled>Save Selection</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:8px;" id="thumbGrid_${modelId}">
        ${videos.map((v, i) => `
          <div id="card_${modelId}_${i}" onclick="toggleVideoCard(${modelId}, ${i})"
            style="border:2px solid var(--border); border-radius:6px; overflow:hidden; cursor:pointer; position:relative; transition:border-color 0.15s;">
            <img src="${escapeHtml(v.thumbnail||'')}" alt="" style="width:100%; aspect-ratio:16/9; object-fit:cover; display:block;">
            <div style="padding:6px 8px;">
              <div style="font-size:11px; font-weight:500; line-height:1.3; margin-bottom:3px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(v.title)}</div>
              <div style="font-size:10px; color:var(--text-faint);">${escapeHtml(v.channel)}</div>
              <div style="font-size:10px; color:var(--text-faint); margin-top:2px;">${formatViews(v.view_count)} · ${v.published_at ? v.published_at.slice(0,10) : ''}</div>
            </div>
            <div id="checkmark_${modelId}_${i}" style="display:none; position:absolute; top:6px; right:6px; background:var(--pos); color:#000; border-radius:50%; width:20px; height:20px; font-size:12px; font-weight:700; align-items:center; justify-content:center;">✓</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleVideoCard(modelId, idx) {
  const sel = candidateSelections[modelId];
  if (!sel) return;
  const v = sel.videos[idx];
  const card = document.getElementById(`card_${modelId}_${idx}`);
  const check = document.getElementById(`checkmark_${modelId}_${idx}`);

  if (sel.selected.has(v.video_id)) {
    sel.selected.delete(v.video_id);
    if (card) card.style.borderColor = 'var(--border)';
    if (check) check.style.display = 'none';
  } else {
    if (sel.selected.size >= 10) {
      alert('Maximum 10 videos per model. Deselect one first.');
      return;
    }
    sel.selected.add(v.video_id);
    if (card) card.style.borderColor = 'var(--pos)';
    if (check) check.style.display = 'flex';
  }

  const count = sel.selected.size;
  const countEl = document.getElementById(`selCount_${modelId}`);
  const saveBtn = document.getElementById(`saveSelBtn_${modelId}`);
  if (countEl) countEl.textContent = `${count} selected`;
  if (saveBtn) saveBtn.disabled = count === 0;
}

async function saveVideoSelection(modelId) {
  const sel = candidateSelections[modelId];
  if (!sel || sel.selected.size === 0) return;

  const saveBtn = document.getElementById(`saveSelBtn_${modelId}`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner"></span> Saving...'; }

  try {
    const selectedVideos = sel.videos
      .filter(v => sel.selected.has(v.video_id))
      .map((v, idx) => ({
        video_id: v.video_id,
        title: v.title,
        channel: v.channel,
        channel_id: v.channel_id,
        published_at: v.published_at,
        video_type: idx === 0 ? 'reviewer' : 'reviewer', // all reviewer; admin can manually set official via manual URL
      }));

    await apiPost('/api/save-video-selection', { model_id: modelId, videos: selectedVideos });

    // refresh data
    const fresh = await apiGet('/api/data');
    STATE.comments = fresh.comments;
    STATE.videoMap = fresh.videoMap;

    renderTopbar();
    renderYoutubeView();
    alert(`${selectedVideos.length} video(s) saved. Old YT comments cleared. Cron will fetch fresh comments next run — or use Run Fetch Batch Now.`);
  } catch (e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = 'Save Selection'; }
    alert('Save failed: ' + e.message);
  }
}

// ---- Manual URL add ----
async function addManualVideo(modelId) {
  const urlInput = document.getElementById('manualUrl_' + modelId);
  const typeSelect = document.getElementById('manualUrlType_' + modelId);
  if (!urlInput) return;

  const urlVal = urlInput.value.trim();
  if (!urlVal) { alert('Paste a YouTube URL first.'); return; }

  // extract video ID
  let videoId = urlVal;
  const match = urlVal.match(/[?&]v=([^&]+)/) || urlVal.match(/youtu\.be\/([^?]+)/) || urlVal.match(/^([a-zA-Z0-9_-]{11})$/);
  if (match) videoId = match[1];
  if (!videoId || videoId.length < 5) { alert('Could not extract a valid video ID from that URL.'); return; }

  const videoType = typeSelect ? typeSelect.value : 'reviewer';

  // get existing selected videos to preserve them
  const existingVideos = Array.isArray(STATE.videoMap[modelId]) ? STATE.videoMap[modelId] : [];
  const newVideo = { video_id: videoId, video_type: videoType, title: null, channel: null, channel_id: null, published_at: null };
  const allVideos = [...existingVideos.map(v => ({ video_id: v.videoId, video_type: v.videoType, title: v.title, channel: v.channel, channel_id: null, published_at: null })), newVideo];

  try {
    await apiPost('/api/save-video-selection', { model_id: modelId, videos: allVideos });
    urlInput.value = '';
    const fresh = await apiGet('/api/data');
    STATE.comments = fresh.comments;
    STATE.videoMap = fresh.videoMap;
    renderTopbar();
    renderYoutubeView();
    alert(`Video added as ${videoType}. Old YT comments cleared. Cron will fetch fresh comments next run.`);
  } catch (e) {
    alert('Failed to add video: ' + e.message);
  }
}
