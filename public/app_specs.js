// public/app_specs.js
// ============================================================
// SPECS DATABASE VIEW — Complete specs + Launch Date + Pricing
// ============================================================

// Format "4 Nov 2026" — also defined in app_ecom.js; safe to call if loaded first
function fmtDate(d) {
  if (!d) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

let specsSortKey = 'model';
let specsSortDir = 'asc';
let specsConnFilter = 'all';

function renderSpecsView() {
  const el = document.getElementById('view-specs');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Specs Database</div>
        <div class="section-sub">Full specifications for all ${STATE.phones.length} models — researched once, stored permanently</div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:14px;">
      <div class="pill-row">
        <span class="pill ${specsConnFilter==='all'?'active':''}" onclick="setSpecsConnFilter('all')">All</span>
        <span class="pill ${specsConnFilter==='5g'?'active':''}" onclick="setSpecsConnFilter('5g')">5G only</span>
        <span class="pill ${specsConnFilter==='4g'?'active':''}" onclick="setSpecsConnFilter('4g')">4G only</span>
      </div>
    </div>
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th onclick="sortSpecs('model')" style="cursor:pointer;">Model ${specsSortKey==='model'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th onclick="sortSpecs('launch_date')" style="cursor:pointer;">Launch Date ${specsSortKey==='launch_date'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th onclick="sortSpecs('launch_price_inr')" style="cursor:pointer;">Launch ₹ ${specsSortKey==='launch_price_inr'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th onclick="sortSpecs('current_price_inr')" style="cursor:pointer;">Current ₹ ${specsSortKey==='current_price_inr'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th>Network</th>
              <th>Processor</th>
              <th>RAM</th>
              <th>Storage</th>
              <th onclick="sortSpecs('battery_mah')" style="cursor:pointer;">Battery ${specsSortKey==='battery_mah'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th>Charging</th>
              <th>Display</th>
              <th>Rear Camera</th>
              <th>Front Camera</th>
              <th>OS</th>
              <th>Connectivity</th>
              <th onclick="sortSpecs('weight_g')" style="cursor:pointer;">Weight ${specsSortKey==='weight_g'?(specsSortDir==='asc'?'↑':'↓'):''}</th>
              <th title="Where the spec data was sourced from">Spec Source</th>
            </tr>
          </thead>
          <tbody id="specsTbody"></tbody>
        </table>
      </div>
    </div>
  `;
  renderSpecsTable();
}

function setSpecsConnFilter(f) {
  specsConnFilter = f;
  renderSpecsView();
}

function sortSpecs(key) {
  if (specsSortKey === key) specsSortDir = specsSortDir === 'asc' ? 'desc' : 'asc';
  else { specsSortKey = key; specsSortDir = 'asc'; }
  renderSpecsTable();
}

function renderSpecsTable() {
  const tbody = document.getElementById('specsTbody');
  if (!tbody) return;

  let rows = STATE.phones.map(p => ({ phone: p, spec: STATE.specs[p.model_id] }));

  // connectivity filter
  if (specsConnFilter === '5g') rows = rows.filter(r => isFiveG(r.spec));
  if (specsConnFilter === '4g') rows = rows.filter(r => r.spec && !isFiveG(r.spec));

  // sort
  rows.sort((a, b) => {
    let av, bv;
    switch (specsSortKey) {
      case 'model':
        av = a.phone.model.toLowerCase();
        bv = b.phone.model.toLowerCase();
        break;
      case 'launch_date':
        av = a.phone.launch_date || '9999';
        bv = b.phone.launch_date || '9999';
        break;
      case 'launch_price_inr':
        av = a.phone.launch_price_inr ?? Infinity;
        bv = b.phone.launch_price_inr ?? Infinity;
        break;
      case 'current_price_inr':
        av = a.phone.current_price_inr ?? a.phone.launch_price_inr ?? Infinity;
        bv = b.phone.current_price_inr ?? b.phone.launch_price_inr ?? Infinity;
        break;
      case 'battery_mah':
        av = a.spec?.battery_mah ?? 0;
        bv = b.spec?.battery_mah ?? 0;
        break;
      case 'weight_g':
        av = a.spec?.weight_g ?? 9999;
        bv = b.spec?.weight_g ?? 9999;
        break;
      default:
        av = 0; bv = 0;
    }
    if (av < bv) return specsSortDir === 'asc' ? -1 : 1;
    if (av > bv) return specsSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = rows.map(({ phone, spec }) => {
    // price difference indicator
    const launchP  = phone.launch_price_inr;
    const currentP = phone.current_price_inr || (phone.base_variant && phone.variant_prices?.[phone.base_variant]?.current);
    const priceDiff = (launchP && currentP && currentP !== launchP)
      ? currentP - launchP
      : null;
    const diffColor = priceDiff === null ? '' : priceDiff > 0 ? 'color:var(--neg);' : 'color:var(--pos);';
    const diffStr   = priceDiff === null ? '' :
      ` <span style="font-size:10px;${diffColor}">(${priceDiff > 0 ? '+' : ''}${priceDiff.toLocaleString('en-IN')})</span>`;

    // Source of current price: prefer scraper source, fall back to 'manual'
    const priceSource = phone.amazon_price && phone.flipkart_price
      ? (phone.amazon_price <= phone.flipkart_price ? 'amazon' : 'flipkart')
      : phone.amazon_price ? 'amazon'
      : phone.flipkart_price ? 'flipkart'
      : (currentP && currentP !== launchP ? 'manual' : null);
    const srcLabel = priceSource === 'amazon'   ? '<span style="font-size:9px; color:#FF9900; font-weight:600;"> ● Amazon</span>'
                   : priceSource === 'flipkart' ? '<span style="font-size:9px; color:#2874F0; font-weight:600;"> ● Flipkart</span>'
                   : priceSource === 'manual'   ? '<span style="font-size:9px; color:var(--text-faint);"> ● Manual</span>'
                   : '';

    // Format "as of" date
    const asOfStr = phone.price_last_updated
      ? `<div style="font-size:10px; color:var(--text-faint);">as of ${fmtDate(phone.price_last_updated)}</div>` : '';

    // Spec source badge (from specs table source_confidence or spec_source field)
    const specSrc = spec?.spec_source || spec?.source_confidence;
    const specSrcLabel = specSrc === 'amazon'   ? '<span style="font-size:9px; padding:1px 4px; background:#FF990022; color:#CC7700; border-radius:3px; white-space:nowrap;">Amazon</span>'
                       : specSrc === 'gsmarena' ? '<span style="font-size:9px; padding:1px 4px; background:#1a73e822; color:#1a73e8; border-radius:3px;">GSMArena</span>'
                       : specSrc === 'manual'   ? '<span style="font-size:9px; padding:1px 4px; background:var(--border-faint,#eee); color:var(--text-faint); border-radius:3px;">Manual</span>'
                       : specSrc              ? `<span style="font-size:9px; padding:1px 4px; background:var(--border-faint,#eee); color:var(--text-faint); border-radius:3px;">${escapeHtml(specSrc)}</span>`
                       : '<span style="font-size:9px; color:var(--text-faint);">–</span>';

    return `
    <tr>
      <td class="model-name">
        <a href="#" onclick="event.preventDefault(); goToModel(${phone.model_id})">${phone.model}</a>
        <div style="font-size:10px; color:var(--text-faint);">${phone.brand || ''}</div>
      </td>
      <td style="font-size:12px; white-space:nowrap;">
        ${phone.launch_date || '–'}
        ${phone.launch_date ? `<div style="font-size:10px; color:var(--text-faint);">${monthsAgo(phone.launch_date)}</div>` : ''}
      </td>
      <td class="num">${launchP ? '₹'+Math.round(launchP).toLocaleString('en-IN') : '–'}</td>
      <td class="num" style="line-height:1.5;">
        ${currentP ? '₹'+Math.round(currentP).toLocaleString('en-IN') : '–'}${diffStr}
        ${srcLabel}
        ${asOfStr}
      </td>
      <td>${spec ? (isFiveG(spec) ? '<span class="badge pos">5G</span>' : '<span class="badge gray">4G</span>') : '<span class="badge gray">?</span>'}</td>
      <td style="font-size:11px; max-width:160px; white-space:normal;">${spec?.processor || '–'}</td>
      <td style="font-size:12px;">${spec?.ram_variants?.join(' / ') || '–'}</td>
      <td style="font-size:12px;">${spec?.storage_variants?.join(' / ') || '–'}</td>
      <td class="num">${spec?.battery_mah ? spec.battery_mah+' mAh' : '–'}</td>
      <td style="font-size:12px; white-space:nowrap;">${spec?.fast_charging_w ? spec.fast_charging_w+'W' : '–'}</td>
      <td style="font-size:11px; max-width:180px; white-space:normal;">${spec?.display || '–'}</td>
      <td style="font-size:11px; max-width:140px; white-space:normal;">${spec?.rear_camera || '–'}</td>
      <td style="font-size:11px;">${spec?.front_camera || '–'}</td>
      <td style="font-size:11px;">${spec?.os || '–'}</td>
      <td style="font-size:11px; max-width:140px; white-space:normal;">${spec?.connectivity || '–'}</td>
      <td class="num">${spec?.weight_g ? spec.weight_g+'g' : '–'}</td>
      <td style="text-align:center;">${specSrcLabel}</td>
    </tr>`;
  }).join('');
}

// Helper: how many months ago was the launch date
function monthsAgo(dateStr) {
  if (!dateStr) return '';
  const months = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return 'this month';
  if (months === 1) return '1 month ago';
  return months + ' months ago';
}
