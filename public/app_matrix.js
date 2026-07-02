// ============================================================
// COMPETITIVE MATRIX VIEW — Module 3
// Replicates the LAVA PPT format: parameters as rows, models as columns
// Each cell: Intensity % + Positivity %
// ============================================================

let matrixSegmentFilter = 'all';

function renderMatrixView() {
  const el = document.getElementById('view-matrix');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Competitive Matrix</div>
        <div class="section-sub">Parameters × Models — Intensity % (how often mentioned) and Positivity % (how favorably) per cell</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-title">Segment</div>
      <div class="pill-row">
        <span class="pill ${matrixSegmentFilter==='all'?'active':''}" onclick="setMatrixSegment('all')">All</span>
        ${Object.entries(PRICE_SEGMENT_LABELS).map(([k,v]) => `<span class="pill ${matrixSegmentFilter===k?'active':''}" onclick="setMatrixSegment('${k}')">${v}</span>`).join('')}
      </div>
    </div>

    <div id="matrixTableBox"></div>
  `;
  renderMatrixTable();
}

function setMatrixSegment(seg) {
  matrixSegmentFilter = seg;
  renderMatrixTable();
}

function renderMatrixTable() {
  const box = document.getElementById('matrixTableBox');
  let models = STATE.phones.filter(p => getLifecycleStatus(p) !== 'frozen');
  if (matrixSegmentFilter !== 'all') models = models.filter(p => p.price_segment === matrixSegmentFilter);

  if (models.length === 0) {
    box.innerHTML = `<div class="empty-state"><div class="title">No active/semi-active models in this segment</div></div>`;
    return;
  }

  // cap to a reasonable column count for readability
  const shownModels = models.slice(0, 12);
  const overflow = models.length - shownModels.length;

  // compute intensity/positivity per model x parameter
  const cellData = {}; // `${modelId}_${param}` -> {intensity, positivity, n}
  shownModels.forEach(p => {
    const tagged = STATE.comments.filter(c => c.model_id === p.model_id && c.tag && isWithinWindow(p, c.comment_date));
    const total = tagged.length;
    PARAMS.forEach(param => {
      let mentionCount = 0, pos = 0, neg = 0;
      tagged.forEach(c => (c.tag.mentions||[]).forEach(m => {
        if (m.parameter === param) {
          mentionCount++;
          if (m.sentiment === 'positive') pos++;
          else if (m.sentiment === 'negative') neg++;
        }
      }));
      const intensity = total > 0 ? Math.round((mentionCount/total)*100) : 0;
      const positivity = (pos+neg) > 0 ? Math.round((pos/(pos+neg))*100) : null;
      cellData[`${p.model_id}_${param}`] = { intensity, positivity, n: mentionCount };
    });
  });

  // only show params that have at least one mention somewhere in this view
  const activeParams = PARAMS.filter(param => shownModels.some(p => cellData[`${p.model_id}_${param}`].n > 0));

  box.innerHTML = `
    ${overflow > 0 ? `<div class="notice warn">Showing first 12 of ${models.length} matching models. Narrow by segment to see others.</div>` : ''}
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="position:sticky; left:0; background:var(--panel);">Parameter</th>
              ${shownModels.map(p => `<th style="min-width:110px;"><a href="#" onclick="event.preventDefault(); goToModel(${p.model_id});" style="font-size:11px;">${escapeHtml(p.model)}</a></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${activeParams.length === 0 ? `<tr><td colspan="${shownModels.length+1}" style="text-align:center; color:var(--text-faint); padding:20px;">No tagged parameter mentions yet for these models — run the Tagging Engine first.</td></tr>` :
            activeParams.map(param => `
              <tr>
                <td style="font-weight:500; position:sticky; left:0; background:var(--panel);">${PARAM_LABELS[param]}</td>
                ${shownModels.map(p => {
                  const cell = cellData[`${p.model_id}_${param}`];
                  if (cell.n === 0) return `<td class="num" style="color:var(--text-faint);">–</td>`;
                  const color = cell.positivity === null ? 'var(--text-faint)' : cell.positivity >= 65 ? 'var(--pos)' : cell.positivity >= 40 ? 'var(--neu)' : 'var(--neg)';
                  return `<td class="num">
                    <div style="font-family:var(--mono); font-size:12px; color:${color}; font-weight:600;">${cell.positivity===null?'–':cell.positivity+'%'}</div>
                    <div style="font-size:10px; color:var(--text-faint);">${cell.intensity}% mention</div>
                  </td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="margin-top:10px; font-size:11px; color:var(--text-faint);">Top number = positivity % (green ≥65%, amber 40-64%, red &lt;40%) · bottom = intensity % (share of tagged comments mentioning this parameter)</div>
    </div>
  `;
}
