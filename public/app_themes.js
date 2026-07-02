// ============================================================
// STRATEGIC THEMES VIEW — window-aware cross-model rollup
// ============================================================

function renderThemesView() {
  const el = document.getElementById('view-themes');
  const tagged = STATE.comments.filter(c => {
    if (!c.tag) return false;
    const phone = STATE.phones.find(p => p.model_id === c.model_id);
    return phone && isWithinWindow(phone, c.comment_date);
  });

  if (tagged.length === 0) {
    el.innerHTML = `
      <div class="section-head"><div><div class="section-title">Strategic Themes</div><div class="section-sub">Cross-model narrative and theme clustering (in-window only)</div></div></div>
      <div class="empty-state">
        <div class="icon">◇</div>
        <div class="title">No in-window tagged data yet</div>
        <div class="desc">Run the Tagging Engine first — this view aggregates narratives and strategic themes across tagged comments still inside each model's 6-month sentiment window.</div>
      </div>
    `;
    return;
  }

  const themeMap = {};
  let nullThemeCount = 0;
  tagged.forEach(c => {
    const t = c.tag.strategic_theme;
    if (!t) { nullThemeCount++; return; }
    if (!themeMap[t]) themeMap[t] = [];
    themeMap[t].push(c);
  });
  const themedTotal = tagged.length - nullThemeCount;

  const narrativeMap = {};
  tagged.forEach(c => {
    const n = (c.tag.narrative || '').trim().toLowerCase();
    if (!n) return;
    if (!narrativeMap[n]) narrativeMap[n] = [];
    narrativeMap[n].push(c);
  });
  const topNarratives = Object.entries(narrativeMap).sort((a,b)=>b[1].length-a[1].length).slice(0,15);

  const paramRollup = {};
  PARAMS.forEach(p => paramRollup[p] = {pos:0,neg:0,mixed:0});
  tagged.forEach(c => {
    (c.tag.mentions||[]).forEach(m => {
      if (!paramRollup[m.parameter]) paramRollup[m.parameter] = {pos:0,neg:0,mixed:0};
      if (m.sentiment === 'positive') paramRollup[m.parameter].pos++;
      else if (m.sentiment === 'negative') paramRollup[m.parameter].neg++;
      else paramRollup[m.parameter].mixed++;
    });
  });

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Strategic Themes</div>
        <div class="section-sub">Cross-model rollup from ${tagged.length} in-window tagged comments — feeds into CIS positioning work</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Strategic Theme Distribution${nullThemeCount>0 ? ` (${nullThemeCount} comments had no clear theme)` : ''}</div>
      ${themedTotal === 0 ? `<div class="empty-state" style="padding:14px;"><div class="desc">No comments had a clear strategic theme assigned</div></div>` : `
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${Object.entries(themeMap).sort((a,b)=>b[1].length-a[1].length).map(([theme, items]) => {
          const pct = Math.round((items.length/themedTotal)*100);
          return `
          <div>
            <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
              <span style="text-transform:capitalize;">${theme.replace(/_/g,' ')}</span>
              <span class="badge gray">${items.length} · ${pct}%</span>
            </div>
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%; background:var(--accent);"></div></div>
          </div>`;
        }).join('')}
      </div>`}
    </div>

    <div class="grid-3">
      <div class="panel" style="grid-column: span 2;">
        <div class="panel-title">Top Recurring Narratives</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Narrative</th><th>Count</th><th>Models</th><th>Sentiment Mix</th></tr></thead>
            <tbody>
              ${topNarratives.map(([narrative, items]) => {
                const modelsInvolved = new Set(items.map(i=>i.model_id)).size;
                const pos = items.filter(i=>i.tag.sentiment==='positive').length;
                const neg = items.filter(i=>i.tag.sentiment==='negative').length;
                return `<tr>
                  <td style="white-space:normal; max-width:240px; font-size:12.5px;">${escapeHtml(narrative)}</td>
                  <td class="num">${items.length}</td>
                  <td class="num">${modelsInvolved}</td>
                  <td><span class="badge pos">${pos}+</span> <span class="badge neg">${neg}−</span></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Parameter Sentiment (All Models)</div>
        <div style="display:flex; flex-direction:column; gap:9px; max-height:340px; overflow-y:auto;">
          ${Object.entries(paramRollup).filter(([,v])=>v.pos+v.neg+v.mixed>0).sort((a,b)=>(b[1].pos+b[1].neg+b[1].mixed)-(a[1].pos+a[1].neg+a[1].mixed)).map(([attr,v]) => {
            const total = v.pos+v.neg+v.mixed;
            const posPct = Math.round((v.pos/total)*100);
            return `<div>
              <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:3px;">
                <span style="color:var(--text-dim);">${PARAM_LABELS[attr]||attr}</span>
                <span style="color:var(--text-faint); font-family:var(--mono);">${total}</span>
              </div>
              <div class="score-bar-track"><div class="score-bar-fill" style="width:${posPct}%; background:var(--pos);"></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Models Driving "Reliability Concern" Theme</div>
      ${renderThemeModelBreakdown('reliability_concern', themeMap)}
    </div>

    <div class="panel">
      <div class="panel-title">Models Driving "Value Seeking" Theme</div>
      ${renderThemeModelBreakdown('value_seeking', themeMap)}
    </div>
  `;
}

function renderThemeModelBreakdown(themeKey, themeMap) {
  const items = themeMap[themeKey] || [];
  if (!items.length) return `<div class="empty-state" style="padding:14px;"><div class="desc">No comments tagged under this theme yet</div></div>`;
  const byModel = {};
  items.forEach(c => { byModel[c.model_id] = (byModel[c.model_id]||0)+1; });
  const sorted = Object.entries(byModel).sort((a,b)=>b[1]-a[1]).slice(0,10);
  return `
    <div class="pill-row">
      ${sorted.map(([modelId,n]) => {
        const phone = STATE.phones.find(p=>p.model_id==modelId);
        return `<span class="pill active" style="cursor:pointer;" onclick="goToModel(${modelId})">${phone?phone.model:modelId} · ${n}</span>`;
      }).join('')}
    </div>
  `;
}
