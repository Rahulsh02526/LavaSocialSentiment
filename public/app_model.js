// ============================================================
// MODEL DEEP-DIVE VIEW
// ============================================================

function renderModelView() {
  const el = document.getElementById('view-model');
  if (!STATE.selectedModelId) STATE.selectedModelId = STATE.phones[0]?.model_id;

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Model Deep-Dive</div>
        <div class="section-sub">Per-model specs, sentiment, parameter breakdown, and raw comment feed</div>
      </div>
      <div style="width:280px;">
        <select id="modelDeepDiveSelect" onchange="onModelDeepDiveChange()">
          ${STATE.phones.map(p => `<option value="${p.model_id}" ${p.model_id===STATE.selectedModelId?'selected':''}>${p.model}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="modelDeepDiveBody"></div>
  `;
  renderModelDeepDiveBody();
}

function onModelDeepDiveChange() {
  STATE.selectedModelId = parseInt(document.getElementById('modelDeepDiveSelect').value);
  renderModelDeepDiveBody();
}

function renderModelDeepDiveBody() {
  const body = document.getElementById('modelDeepDiveBody');
  const phone = STATE.phones.find(p => p.model_id === STATE.selectedModelId);
  if (!phone) { body.innerHTML = ''; return; }
  const spec = STATE.specs[phone.model_id];

  const comments = STATE.comments.filter(c => c.model_id === phone.model_id);
  const inWindowComments = comments.filter(c => isWithinWindow(phone, c.comment_date));
  const tagged = inWindowComments.filter(c => c.tag);
  const taggedEcom = tagged.filter(c => c.source === 'Amazon' || c.source === 'Flipkart');
  const taggedYT = tagged.filter(c => c.source === 'YouTube');
  const status = getLifecycleStatus(phone);

  function sentCount(arr) {
    const s = { positive:0, negative:0, mixed:0, neutral:0 };
    arr.forEach(c => { const v=(c.tag.sentiment||'neutral').toLowerCase(); if(s[v]!==undefined) s[v]++; else s.neutral++; });
    return s;
  }
  const sentCounts = sentCount(tagged);
  const sentCountsEcom = sentCount(taggedEcom);
  const sentCountsYT = sentCount(taggedYT);

  const paramAgg = {};
  PARAMS.forEach(p => paramAgg[p] = { pos:0, neg:0, mixed:0, n:0 });
  tagged.forEach(c => {
    (c.tag.mentions||[]).forEach(m => {
      const key = m.parameter;
      if (paramAgg[key]) {
        paramAgg[key].n++;
        if (m.sentiment === 'positive') paramAgg[key].pos++;
        else if (m.sentiment === 'negative') paramAgg[key].neg++;
        else paramAgg[key].mixed++;
      }
    });
  });

  const themeCounts = {};
  tagged.forEach(c => { if (c.tag.strategic_theme) themeCounts[c.tag.strategic_theme] = (themeCounts[c.tag.strategic_theme]||0)+1; });
  const untaggedThemeCount = tagged.filter(c => !c.tag.strategic_theme).length;

  const videoMappings = STATE.videoMap[phone.model_id] || [];
  const officialVideo = Array.isArray(videoMappings) ? videoMappings.find(v => v.videoType === 'official') : null;
  const reviewerVideoCount = Array.isArray(videoMappings) ? videoMappings.filter(v => v.videoType === 'reviewer').length : 0;

  body.innerHTML = `
    <div class="grid-4" style="margin-bottom:18px;">
      <div class="kpi"><div class="kpi-label">Launch Price</div><div class="kpi-value">${phone.launch_price_inr ? '₹'+Math.round(phone.launch_price_inr).toLocaleString('en-IN') : '–'}</div><div class="kpi-sub">${phone.launch_date||''} · ${PRICE_SEGMENT_LABELS[phone.price_segment]||phone.price_segment||''}</div></div>
      <div class="kpi"><div class="kpi-label">Lifecycle Status</div><div class="kpi-value" style="font-size:16px;">${lifecycleBadge(status)}</div><div class="kpi-sub">sentiment freeze: ${phone.sentiment_frozen_at||'–'} · price freeze: ${phone.price_frozen_at||'–'}</div></div>
      <div class="kpi"><div class="kpi-label">Brand / Tier</div><div class="kpi-value" style="font-size:16px; text-transform:capitalize;">${phone.brand||'–'}</div><div class="kpi-sub">${phone.brand_tier ? 'Tier '+phone.brand_tier : 'Ad-hoc / untiered'}</div></div>
      <div class="kpi"><div class="kpi-label">Comments</div><div class="kpi-value">${comments.length}</div><div class="kpi-sub">E-com: ${taggedEcom.length} tagged · YT: ${taggedYT.length} tagged</div></div>
    </div>

    ${spec || phone.image_url ? `
    <div class="panel">
      <div style="display:flex; gap:24px; align-items:flex-start;">
        ${phone.image_url ? `
        <div style="flex-shrink:0; text-align:center;">
          <img src="${escapeHtml(phone.image_url)}"
            alt="${escapeHtml(phone.model)}"
            style="width:180px; height:260px; object-fit:contain; border-radius:8px; background:var(--panel-2); padding:12px;"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div style="display:none; width:180px; height:260px; background:var(--panel-2); border-radius:8px; align-items:center; justify-content:center; color:var(--text-faint); font-size:12px; flex-direction:column; gap:6px;">
            <span style="font-size:32px;">📱</span>
            <span>No image</span>
          </div>
        </div>` : ''}
        ${spec ? `
        <div style="flex:1;">
          <div class="panel-title">Full Specifications</div>
          <div class="grid-4">
            <div><label>RAM</label><div style="font-size:13px;">${(spec.ram_variants||[]).join(' / ')}</div></div>
            <div><label>Storage</label><div style="font-size:13px;">${(spec.storage_variants||[]).join(' / ')}</div></div>
            <div><label>Display</label><div style="font-size:13px;">${spec.display||'–'}</div></div>
            <div><label>Battery</label><div style="font-size:13px;">${spec.battery_mah?spec.battery_mah+' mAh':'–'}${spec.fast_charging_w?', '+spec.fast_charging_w+'W charging':''}</div></div>
            <div><label>Rear Camera</label><div style="font-size:13px;">${spec.rear_camera||'–'}</div></div>
            <div><label>Front Camera</label><div style="font-size:13px;">${spec.front_camera||'–'}</div></div>
            <div><label>OS</label><div style="font-size:13px;">${spec.os||'–'}</div></div>
            <div><label>Weight</label><div style="font-size:13px;">${spec.weight_g?spec.weight_g+'g':'–'}</div></div>
          </div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-title">Marketing Assets</div>
      <div id="marketingAssetsBox"></div>
    </div>

    ${status === 'frozen' ? `<div class="notice warn">This model's sentiment and price tracking are both frozen (past 12 months). Data shown is preserved for historical/temporal analysis only.</div>` :
      status === 'semi_active' ? `<div class="notice warn">Sentiment tracking is frozen for this model (past 6 months) — only price updates continue. Comment data below reflects what was captured before the freeze.</div>` : ''}

    ${videoMappings.length > 0 ? `
    <div class="notice">
      ${officialVideo ? `Official: <b>${escapeHtml(officialVideo.title)}</b> (${escapeHtml(officialVideo.channel)}) — <a href="https://youtube.com/watch?v=${officialVideo.videoId}" target="_blank">view ↗</a> · ` : 'No official video · '}
      ${reviewerVideoCount} reviewer video${reviewerVideoCount===1?'':'s'} mapped
    </div>` : `
    <div class="notice warn">No YouTube videos mapped for this model yet. Go to the YouTube tab to run a fetch.</div>
    `}

    <div class="grid-3">
      <div class="panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div class="panel-title" style="margin:0;">Sentiment</div>
          <div style="display:flex; gap:4px;">
            <span class="pill active" id="sentTab_all" onclick="setSentTab('all',${phone.model_id})" style="font-size:10px; padding:2px 8px;">All (${tagged.length})</span>
            <span class="pill" id="sentTab_ecom" onclick="setSentTab('ecom',${phone.model_id})" style="font-size:10px; padding:2px 8px;">E-com (${taggedEcom.length})</span>
            <span class="pill" id="sentTab_yt" onclick="setSentTab('yt',${phone.model_id})" style="font-size:10px; padding:2px 8px;">YT (${taggedYT.length})</span>
          </div>
        </div>
        <div id="sentPanel_all">
          ${tagged.length===0 ? `<div class="empty-state" style="padding:14px;"><div class="desc">No tagged comments yet</div></div>` : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${renderSentBar('Positive', sentCounts.positive, tagged.length, 'pos')}
            ${renderSentBar('Negative', sentCounts.negative, tagged.length, 'neg')}
            ${renderSentBar('Mixed', sentCounts.mixed, tagged.length, 'neu')}
            ${renderSentBar('Neutral', sentCounts.neutral, tagged.length, 'gray')}
          </div>`}
        </div>
        <div id="sentPanel_ecom" style="display:none;">
          ${taggedEcom.length===0 ? `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">No tagged E-com comments for this model</div>` : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${renderSentBar('Positive', sentCountsEcom.positive, taggedEcom.length, 'pos')}
            ${renderSentBar('Negative', sentCountsEcom.negative, taggedEcom.length, 'neg')}
            ${renderSentBar('Mixed', sentCountsEcom.mixed, taggedEcom.length, 'neu')}
            ${renderSentBar('Neutral', sentCountsEcom.neutral, taggedEcom.length, 'gray')}
          </div>`}
        </div>
        <div id="sentPanel_yt" style="display:none;">
          ${taggedYT.length===0 ? `<div style="font-size:12px; color:var(--text-faint); padding:10px 0;">No tagged YouTube comments for this model</div>` : `
          <div style="display:flex; flex-direction:column; gap:10px;">
            ${renderSentBar('Positive', sentCountsYT.positive, taggedYT.length, 'pos')}
            ${renderSentBar('Negative', sentCountsYT.negative, taggedYT.length, 'neg')}
            ${renderSentBar('Mixed', sentCountsYT.mixed, taggedYT.length, 'neu')}
            ${renderSentBar('Neutral', sentCountsYT.neutral, taggedYT.length, 'gray')}
          </div>`}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Parameters Mentioned</div>
        ${Object.values(paramAgg).every(a=>a.n===0) ? `<div class="empty-state" style="padding:14px;"><div class="desc">No parameter mentions tagged yet</div></div>` : `
        <div style="display:flex; flex-direction:column; gap:8px; max-height:280px; overflow-y:auto;">
          ${PARAMS.map(p => {
            const a = paramAgg[p];
            if (a.n === 0) return '';
            const posPct = Math.round((a.pos/a.n)*100);
            return `<div>
              <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:3px;">
                <span style="color:var(--text-dim);">${PARAM_LABELS[p]}</span>
                <span style="color:var(--text-faint); font-family:var(--mono);">${a.n} mentions</span>
              </div>
              <div class="score-bar-track"><div class="score-bar-fill" style="width:${posPct}%; background:var(--pos);"></div></div>
            </div>`;
          }).join('')}
        </div>`}
      </div>

      <div class="panel">
        <div class="panel-title">Strategic Themes</div>
        ${Object.keys(themeCounts).length===0 ? `<div class="empty-state" style="padding:14px;"><div class="desc">No themes assigned yet</div></div>` : `
        <div class="pill-row">
          ${Object.entries(themeCounts).sort((a,b)=>b[1]-a[1]).map(([t,n]) => `<span class="pill active">${t.replace(/_/g,' ')} · ${n}</span>`).join('')}
        </div>
        ${untaggedThemeCount > 0 ? `<div style="font-size:11px; color:var(--text-faint); margin-top:8px;">${untaggedThemeCount} tagged comments had no clear strategic theme (null)</div>` : ''}
        `}
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">All Comments (${comments.length}) ${comments.length > inWindowComments.length ? `<span style="font-weight:400; color:var(--text-faint); font-size:11px;">— ${comments.length - inWindowComments.length} outside the sentiment window, excluded from charts above</span>` : ''}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Source</th><th>Window</th><th>Comment</th><th>Sentiment</th><th>Narrative</th></tr></thead>
          <tbody>
            ${comments.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:var(--text-faint); padding:20px;">No comments captured for this model yet</td></tr>` :
            comments.map(c => {
              const inWindow = isWithinWindow(phone, c.comment_date);
              return `
              <tr>
                <td><span class="src-badge ${c.source.toLowerCase()}">${c.source}</span></td>
                <td>${inWindow ? '<span class="badge pos">In</span>' : '<span class="badge gray">Out</span>'}</td>
                <td style="max-width:380px; white-space:normal; font-size:12.5px;">${escapeHtml(c.comment_text)}</td>
                <td>${c.tag ? sentBadge(c.tag.sentiment) : '<span class="badge gray">untagged</span>'}</td>
                <td style="font-size:12px; white-space:normal; max-width:160px; color:var(--text-dim);">${c.tag ? escapeHtml(c.tag.narrative||'–') : '–'}</td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  renderMarketingAssetsBox(phone.model_id);
}

// ============================================================
// MARKETING ASSETS — per-model campaign images/videos (URL-based)
// ============================================================

function assetTypeIcon(type) {
  if (type === 'video') return '▶';
  return '🖼';
}

function renderMarketingAssetsBox(modelId) {
  const box = document.getElementById('marketingAssetsBox');
  if (!box) return;
  const assets = getAssetsForModel(modelId);

  box.innerHTML = `
    <div class="notice" style="margin-bottom:12px;">
      Assets are stored as links only (image/video URLs) — nothing is uploaded or hosted here. Paste a URL from wherever the asset already lives (Drive, YouTube, Instagram, a CDN, etc.).
    </div>
    ${assets.length === 0 ? `<div class="empty-state" style="padding:16px;"><div class="desc">No marketing assets added for this model yet</div></div>` : `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
      ${assets.map(a => `
        <div class="model-card" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1;">
            <div class="model-card-name">${assetTypeIcon(a.type)} ${escapeHtml(a.campaign_name||'Untitled')} <span class="src-badge ${a.platform?.toLowerCase()||''}" style="margin-left:6px;">${escapeHtml(a.platform||'')}</span></div>
            <div class="model-card-meta">${a.date||'no date'} ${a.tags&&a.tags.length?'· '+a.tags.map(t=>escapeHtml(t)).join(', '):''}</div>
            <a href="${escapeHtml(a.url)}" target="_blank" style="font-size:11px; word-break:break-all;">${escapeHtml(a.url)}</a>
            ${a.notes ? `<div style="font-size:11px; color:var(--text-faint); margin-top:4px;">${escapeHtml(a.notes)}</div>` : ''}
          </div>
          <button class="small danger" onclick="${isAdminLoggedIn() ? `removeMarketingAsset(${modelId}, '${a.id}')` : 'promptAdminLoginRedirect()'}">Remove</button>
        </div>
      `).join('')}
    </div>`}

    <button class="small" onclick="${isAdminLoggedIn() ? `toggleAddAssetForm(${modelId})` : 'promptAdminLoginRedirect()'}">${isAdminLoggedIn() ? '+ Add Asset' : 'Admin Login Required'}</button>
    <div id="addAssetForm_${modelId}" style="display:none; margin-top:12px;">
      <div class="grid-4">
        <div class="field">
          <label>Type</label>
          <select id="assetType_${modelId}">
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div class="field">
          <label>Platform</label>
          <select id="assetPlatform_${modelId}">
            <option value="YouTube">YouTube</option>
            <option value="Instagram">Instagram</option>
            <option value="Other">Other / Hosted</option>
          </select>
        </div>
        <div class="field">
          <label>Campaign Name</label>
          <input type="text" id="assetCampaign_${modelId}" placeholder="e.g. Launch Film">
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" id="assetDate_${modelId}">
        </div>
      </div>
      <div class="field">
        <label>URL</label>
        <input type="text" id="assetUrl_${modelId}" placeholder="https://...">
      </div>
      <div class="field">
        <label>Tags (comma separated)</label>
        <input type="text" id="assetTags_${modelId}" placeholder="e.g. battery, hero shot, festive">
      </div>
      <div class="field">
        <label>Notes</label>
        <input type="text" id="assetNotes_${modelId}" placeholder="optional">
      </div>
      <div style="display:flex; gap:8px;">
        <button class="primary small" onclick="submitMarketingAsset(${modelId})">Save Asset</button>
        <button class="ghost small" onclick="toggleAddAssetForm(${modelId})">Cancel</button>
      </div>
    </div>
  `;
}

function toggleAddAssetForm(modelId) {
  const form = document.getElementById('addAssetForm_' + modelId);
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function submitMarketingAsset(modelId) {
  const url = document.getElementById('assetUrl_' + modelId).value.trim();
  if (!url) { alert('A URL is required.'); return; }
  const payload = {
    model_id: modelId,
    type: document.getElementById('assetType_' + modelId).value,
    platform: document.getElementById('assetPlatform_' + modelId).value,
    campaign_name: document.getElementById('assetCampaign_' + modelId).value.trim(),
    date: document.getElementById('assetDate_' + modelId).value || null,
    url,
    tags: document.getElementById('assetTags_' + modelId).value.split(',').map(t=>t.trim()).filter(Boolean),
    notes: document.getElementById('assetNotes_' + modelId).value.trim(),
  };
  try {
    const result = await apiPost('/api/assets', payload);
    if (!STATE.marketingAssets[modelId]) STATE.marketingAssets[modelId] = [];
    STATE.marketingAssets[modelId].push({
      id: result.asset.id, type: result.asset.type, platform: result.asset.platform,
      campaign_name: result.asset.campaign_name, date: result.asset.asset_date,
      url: result.asset.url, tags: result.asset.tags, notes: result.asset.notes,
    });
    renderMarketingAssetsBox(modelId);
  } catch (e) {
    alert('Failed to save asset: ' + e.message);
  }
}

async function removeMarketingAsset(modelId, assetId) {
  if (!STATE.marketingAssets[modelId]) return;
  try {
    await apiDelete('/api/assets?id=' + encodeURIComponent(assetId));
    STATE.marketingAssets[modelId] = STATE.marketingAssets[modelId].filter(a => a.id !== assetId);
    renderMarketingAssetsBox(modelId);
  } catch (e) {
    alert('Failed to remove asset: ' + e.message);
  }
}

function setSentTab(tab, modelId) {
  ['all','ecom','yt'].forEach(t => {
    const panel = document.getElementById('sentPanel_' + t);
    const btn = document.getElementById('sentTab_' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
}
