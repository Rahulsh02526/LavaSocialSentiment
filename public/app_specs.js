// ============================================================
// SPECS DATABASE VIEW
// ============================================================

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
              <th onclick="sortSpecs('model')" style="cursor:pointer;">Model</th>
              <th onclick="sortSpecs('launch_price_inr')" style="cursor:pointer;">Price</th>
              <th>Network</th>
              <th>Processor</th>
              <th>RAM</th>
              <th onclick="sortSpecs('battery_mah')" style="cursor:pointer;">Battery</th>
              <th>Display</th>
              <th>Rear Camera</th>
              <th>OS</th>
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

  if (specsConnFilter === '5g') rows = rows.filter(r => isFiveG(r.spec));
  if (specsConnFilter === '4g') rows = rows.filter(r => r.spec && !isFiveG(r.spec));

  rows.sort((a,b) => {
    let av, bv;
    if (specsSortKey === 'model') { av = a.phone.model.toLowerCase(); bv = b.phone.model.toLowerCase(); }
    else if (specsSortKey === 'launch_price_inr') { av = a.phone.launch_price_inr ?? Infinity; bv = b.phone.launch_price_inr ?? Infinity; }
    else if (specsSortKey === 'battery_mah') { av = a.spec?.battery_mah ?? 0; bv = b.spec?.battery_mah ?? 0; }
    if (av < bv) return specsSortDir === 'asc' ? -1 : 1;
    if (av > bv) return specsSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = rows.map(({phone, spec}) => `
    <tr>
      <td class="model-name"><a href="#" onclick="event.preventDefault(); goToModel(${phone.model_id})">${phone.model}</a></td>
      <td class="num">${phone.launch_price_inr ? '₹'+Math.round(phone.launch_price_inr).toLocaleString('en-IN') : '–'}</td>
      <td>${spec ? (isFiveG(spec) ? '<span class="badge pos">5G</span>' : '<span class="badge gray">4G only</span>') : '<span class="badge gray">?</span>'}</td>
      <td style="font-size:12px;">${spec?.processor || '–'}</td>
      <td style="font-size:12px;">${spec?.ram_variants?.join('/') || '–'}</td>
      <td class="num">${spec?.battery_mah ? spec.battery_mah+' mAh' : '–'}</td>
      <td style="font-size:12px; max-width:200px; white-space:normal;">${spec?.display || '–'}</td>
      <td style="font-size:12px; max-width:160px; white-space:normal;">${spec?.rear_camera || '–'}</td>
      <td style="font-size:12px;">${spec?.os || '–'}</td>
    </tr>
  `).join('');
}
