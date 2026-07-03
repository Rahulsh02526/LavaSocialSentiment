// public/app_query.js
// ============================================================
// QUERY / COMPETITION ANALYSIS VIEW (Vercel build)
// One call to /api/query does parse + DB filter + synthesize server-side.
// ============================================================

let queryFilters = { minPrice: '', maxPrice: '', network: 'all', brand: 'all', segment: 'all' };
let queryBusy = false;
let queryAnswer = null;
let queryMatchedModels = [];
let queryFocusParameter = null;

function renderQueryView() {
  const el = document.getElementById('view-query');
  const brands = [...new Set(STATE.phones.map(p => p.model.split(' ')[0]))].sort();

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Query &amp; Competition Analysis</div>
        <div class="section-sub">Start here — ask a positioning question or set filters. Combines specs, sentiment, and marketing assets into a synthesized answer.</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Free-Text Question</div>
      <div class="field">
        <textarea id="queryFreeText" rows="2" placeholder="e.g. I have a phone in the ₹10K range and want to position on battery — what are competitors doing?"></textarea>
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="primary" onclick="runQuery()" id="runQueryBtn" ${queryBusy?'disabled':''}>${queryBusy?'<span class="spinner"></span> Analyzing...':'Analyze'}</button>
        <span style="font-size:11px; color:var(--text-faint); align-self:center;">Detects a specific parameter to position around if named, falls back to filters below if ambiguous.</span>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Or Set Filters Directly</div>
      <div class="grid-4">
        <div class="field">
          <label>Min Price (₹)</label>
          <input type="number" id="filterMinPrice" placeholder="e.g. 10000" value="${queryFilters.minPrice}">
        </div>
        <div class="field">
          <label>Max Price (₹)</label>
          <input type="number" id="filterMaxPrice" placeholder="e.g. 15000" value="${queryFilters.maxPrice}">
        </div>
        <div class="field">
          <label>Price Segment</label>
          <select id="filterSegment">
            <option value="all">All</option>
            ${Object.entries(PRICE_SEGMENT_LABELS).map(([k,v]) => `<option value="${k}" ${queryFilters.segment===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Network</label>
          <select id="filterNetwork">
            <option value="all" ${queryFilters.network==='all'?'selected':''}>All</option>
            <option value="5g" ${queryFilters.network==='5g'?'selected':''}>5G only</option>
            <option value="4g" ${queryFilters.network==='4g'?'selected':''}>4G only</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:10px;">
        <label>Brand</label>
        <select id="filterBrand">
          <option value="all">All</option>
          ${brands.map(b => `<option value="${b}" ${queryFilters.brand===b?'selected':''}>${b}</option>`).join('')}
        </select>
      </div>
      <button class="small" onclick="applyFiltersDirectly()" style="margin-top:8px;">Apply Filters</button>
    </div>

    <div id="queryResultsBox"></div>
  `;

  if (queryAnswer || queryMatchedModels.length) renderQueryResultsOnly();
}

function applyFiltersDirectly() {
  queryFilters.minPrice = document.getElementById('filterMinPrice').value;
  queryFilters.segment = document.getElementById('filterSegment').value;
  queryFilters.maxPrice = document.getElementById('filterMaxPrice').value;
  queryFilters.network = document.getElementById('filterNetwork').value;
  queryFilters.brand = document.getElementById('filterBrand').value;
  queryAnswer = null;
  queryFocusParameter = null;

  // client-side filter against already-loaded STATE.phones for instant feedback
  // (no Claude call needed when using filters directly, no narrative synthesis either)
  queryMatchedModels = STATE.phones.filter(p => {
    const spec = STATE.specs[p.model_id];
    if (queryFilters.minPrice && p.launch_price_inr != null && p.launch_price_inr < parseFloat(queryFilters.minPrice)) return false;
    if (queryFilters.maxPrice && p.launch_price_inr != null && p.launch_price_inr > parseFloat(queryFilters.maxPrice)) return false;
    if (queryFilters.segment !== 'all' && p.price_segment !== queryFilters.segment) return false;
    if (queryFilters.network === '5g' && !isFiveG(spec)) return false;
    if (queryFilters.network === '4g' && isFiveG(spec)) return false;
    if (queryFilters.brand !== 'all' && !p.model.toLowerCase().startsWith(queryFilters.brand.toLowerCase())) return false;
    return true;
  });
  renderQueryResultsOnly();
}

async function runQuery() {
  const text = document.getElementById('queryFreeText').value.trim();
  if (!text) { alert('Type a question first, or use the filters below.'); return; }

  queryBusy = true;
  document.getElementById('runQueryBtn').disabled = true;
  document.getElementById('runQueryBtn').innerHTML = '<span class="spinner"></span> Analyzing...';

  try {
    const result = await apiPost('/api/query', { text });
    queryFilters = { ...queryFilters, ...result.filters };
    queryFocusParameter = result.focusParameter;
    queryMatchedModels = result.matchedModels.map(m => {
      // map server summary shape back to something compatible with the table renderer,
      // which expects phone-like objects with model_id; we don't have model_id in the
      // summary, so look it up by name (safe here since model names are unique)
      const phone = STATE.phones.find(p => p.model === m.model);
      return phone ? { ...phone, _summary: m } : { model: m.model, _summary: m };
    });
    queryAnswer = result.answer;
    renderQueryResultsOnly();
  } catch (e) {
    queryAnswer = 'Query failed: ' + e.message;
    queryMatchedModels = [];
    renderQueryResultsOnly();
  }

  queryBusy = false;
  document.getElementById('runQueryBtn').disabled = false;
  document.getElementById('runQueryBtn').innerHTML = 'Analyze';
}

function renderQueryResultsOnly() {
  const box = document.getElementById('queryResultsBox');
  if (box) box.innerHTML = buildQueryResultsHtml();
}

function buildQueryResultsHtml() {
  const filterSummary = [
    queryFilters.minPrice ? `≥₹${parseInt(queryFilters.minPrice).toLocaleString('en-IN')}` : null,
    queryFilters.maxPrice ? `≤₹${parseInt(queryFilters.maxPrice).toLocaleString('en-IN')}` : null,
    queryFilters.segment && queryFilters.segment !== 'all' ? PRICE_SEGMENT_LABELS[queryFilters.segment] : null,
    queryFilters.network !== 'all' ? queryFilters.network.toUpperCase() : null,
    queryFilters.brand !== 'all' ? queryFilters.brand : null,
  ].filter(Boolean).join(' · ') || 'no filters';

  return `
    ${queryAnswer ? `
    <div class="panel">
      <div class="panel-title">Analysis${queryFocusParameter ? ` — positioning on ${PARAM_LABELS[queryFocusParameter]}` : ''}</div>
      <div style="font-size:13px; line-height:1.7; color:var(--text);">${escapeHtml(queryAnswer).split('\n\n').map(p=>`<p style="margin:0 0 12px 0;">${p}</p>`).join('')}</div>
    </div>` : ''}

    <div class="panel">
      <div class="panel-title">Matched Models (${queryMatchedModels.length}) — ${filterSummary}</div>
      ${queryMatchedModels.length === 0 ? `<div class="empty-state" style="padding:20px;"><div class="desc">No models match these filters</div></div>` : `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Model</th><th>Price</th><th>Segment</th><th>Network</th><th>Battery</th><th>Processor</th><th>Comments</th>${queryFocusParameter ? `<th>${PARAM_LABELS[queryFocusParameter]}</th>` : '<th>Sentiment</th>'}<th>Assets</th></tr></thead>
          <tbody>
            ${queryMatchedModels.map(p => {
              const spec = STATE.specs[p.model_id] || (p._summary ? { connectivity: p._summary.connectivity, battery_mah: p._summary.battery_mah, processor: p._summary.processor } : {});
              const assets = p.model_id ? getAssetsForModel(p.model_id) : (p._summary?.marketing_assets || []);

              // comment count breakdown by source
              let commentsCell = '–';
              if (p.model_id) {
                const allComments = STATE.comments.filter(c => c.model_id === p.model_id);
                const ecomCount = allComments.filter(c => c.source === 'Amazon' || c.source === 'Flipkart').length;
                const ytCount = allComments.filter(c => c.source === 'YouTube').length;
                const taggedCount = allComments.filter(c => c.tag).length;
                commentsCell = `<div style="font-size:11px; line-height:1.6;">
                  ${ecomCount > 0 ? `<span style="color:var(--text-dim);">E-com: ${ecomCount}</span><br>` : ''}
                  ${ytCount > 0 ? `<span style="color:var(--neg);">YT: ${ytCount}</span><br>` : ''}
                  <span style="color:var(--text-faint);">Tagged: ${taggedCount}</span>
                </div>`;
              } else if (p._summary) {
                commentsCell = `<span style="font-size:11px; color:var(--text-faint);">${p._summary.tagged_comment_count} tagged</span>`;
              }

              let sentCell;
              if (p._summary) {
                if (queryFocusParameter && p._summary.parameter_sentiment?.[queryFocusParameter]) {
                  const ps = p._summary.parameter_sentiment[queryFocusParameter];
                  sentCell = `<span class="badge pos">${ps.pos}+</span> <span class="badge neg">${ps.neg}−</span>`;
                } else {
                  const sb = p._summary.sentiment_breakdown || {};
                  sentCell = p._summary.tagged_comment_count ? `<span class="badge pos">${sb.positive||0}+</span> <span class="badge neg">${sb.negative||0}−</span>` : '<span class="badge gray">untagged</span>';
                }
              } else {
                const tagged = STATE.comments.filter(c => c.model_id === p.model_id && c.tag && isWithinWindow(p, c.comment_date));
                const pos = tagged.filter(c=>c.tag.sentiment==='positive').length;
                const neg = tagged.filter(c=>c.tag.sentiment==='negative').length;
                sentCell = tagged.length ? `<span class="badge pos">${pos}+</span> <span class="badge neg">${neg}−</span>` : '<span class="badge gray">untagged</span>';
              }
              return `<tr>
                <td class="model-name">${p.model_id ? `<a href="#" onclick="event.preventDefault(); goToModel(${p.model_id})">${p.model}</a>` : p.model}</td>
                <td class="num">${p.launch_price_inr ? '₹'+Math.round(p.launch_price_inr).toLocaleString('en-IN') : '–'}</td>
                <td style="font-size:11px;">${p.price_segment ? p.price_segment.replace('_',' ') : '–'}</td>
                <td>${isFiveG(spec) ? '<span class="badge pos">5G</span>' : '<span class="badge gray">4G</span>'}</td>
                <td class="num">${spec.battery_mah ? spec.battery_mah+' mAh' : '–'}</td>
                <td style="font-size:12px;">${spec.processor || '–'}</td>
                <td>${commentsCell}</td>
                <td>${sentCell}</td>
                <td>${assets.length ? `<span class="badge gray" ${p.model_id?`style="cursor:pointer;" onclick="goToModel(${p.model_id})"`:''}>${assets.length} ↗</span>` : '<span style="color:var(--text-faint); font-size:11px;">none</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
  `;
}
