// ============================================================
// OVERVIEW VIEW
// ============================================================

function renderOverview() {
  const el = document.getElementById('view-overview');
  const totalModels = STATE.phones.length;
  const totalComments = STATE.comments.length;
  const taggedComments = STATE.comments.filter(c => c.tag);
  const taggedCount = taggedComments.length;
  const pctTagged = totalComments ? Math.round((taggedCount/totalComments)*100) : 0;

  const lifecycleCounts = { active: 0, semi_active: 0, frozen: 0 };
  STATE.phones.forEach(p => { const s = getLifecycleStatus(p); if (lifecycleCounts[s] !== undefined) lifecycleCounts[s]++; });

  const sentCounts = { positive:0, negative:0, mixed:0, neutral:0 };
  taggedComments.forEach(c => {
    const s = (c.tag.sentiment || 'neutral').toLowerCase();
    if (sentCounts[s] !== undefined) sentCounts[s]++;
    else sentCounts.neutral++;
  });

  const sourceCounts = {};
  STATE.comments.forEach(c => { sourceCounts[c.source] = (sourceCounts[c.source]||0) + 1; });

  const ECOM_RATING_PARAMS = ['camera','battery','display','design','performance','build','vfm'];
  const ECOM_RATING_LABELS = { camera:'Camera', battery:'Battery', display:'Display', design:'Design', performance:'Performance', build:'Build Quality', vfm:'Value for Money' };
  const paramAgg = {};
  ECOM_RATING_PARAMS.forEach(p => paramAgg[p] = { sum:0, n:0 });
  STATE.phones.forEach(ph => {
    ECOM_RATING_PARAMS.forEach(p => {
      const a = ph['amazon_'+p], f = ph['flipkart_'+p];
      if (a != null) { paramAgg[p].sum += a; paramAgg[p].n++; }
      if (f != null) { paramAgg[p].sum += f; paramAgg[p].n++; }
    });
  });

  const fiveGCount = Object.values(STATE.specs).filter(s => s.connectivity && !s.connectivity.includes('4G only')).length;
  const fourGOnlyCount = totalModels - fiveGCount;

  const byModel = {};
  STATE.comments.forEach(c => { byModel[c.model_id] = (byModel[c.model_id]||0)+1; });
  const topModels = Object.entries(byModel).sort((a,b)=>b[1]-a[1]).slice(0,6)
    .map(([mid,n]) => ({ phone: STATE.phones.find(p=>p.model_id==mid), n }));

  el.innerHTML = `
    ${totalComments > 0 && taggedCount === 0 ? `
    <div class="notice">
      <b>Nothing tagged yet.</b> Head to the <b>Tagging Engine</b> tab to run sentiment tagging on your ${totalComments} comments. Tags are cached, so you only pay the Claude API cost once per comment.
    </div>` : ''}

    <div class="section-head">
      <div>
        <div class="section-title">Snapshot</div>
        <div class="section-sub">Smartphone market research · ≤₹30,000 segment · ${totalModels} models tracked · 6-month analysis window per model</div>
      </div>
    </div>

    <div class="grid-4" style="margin-bottom: 18px;">
      <div class="kpi">
        <div class="kpi-label">Models Tracked</div>
        <div class="kpi-value">${totalModels}</div>
        <div class="kpi-sub">${fiveGCount} 5G · ${fourGOnlyCount} 4G-only</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Total Comments</div>
        <div class="kpi-value">${totalComments}</div>
        <div class="kpi-sub">${Object.entries(sourceCounts).map(([s,n])=>`${n} ${s}`).join(' · ')}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Tagged Coverage</div>
        <div class="kpi-value">${pctTagged}%</div>
        <div class="kpi-sub">${taggedCount} of ${totalComments} comments tagged</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Lifecycle Status</div>
        <div class="kpi-value">${lifecycleCounts.active}/${totalModels}</div>
        <div class="kpi-sub">active · ${lifecycleCounts.semi_active} semi-active · ${lifecycleCounts.frozen} frozen</div>
      </div>
    </div>

    <div class="grid-3">
      <div class="panel">
        <div class="panel-title">Sentiment Split (Tagged Only)</div>
        ${taggedCount === 0 ? `<div class="empty-state" style="padding:20px;"><div class="desc">No tagged comments yet</div></div>` : `
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${renderSentBar('Positive', sentCounts.positive, taggedCount, 'pos')}
          ${renderSentBar('Negative', sentCounts.negative, taggedCount, 'neg')}
          ${renderSentBar('Mixed', sentCounts.mixed, taggedCount, 'neu')}
          ${renderSentBar('Neutral', sentCounts.neutral, taggedCount, 'gray')}
        </div>`}
      </div>

      <div class="panel">
        <div class="panel-title">Parameter Scores (Platform Ratings Avg)</div>
        <div style="display:flex; flex-direction:column; gap:9px;">
          ${ECOM_RATING_PARAMS.map(p => {
            const a = paramAgg[p];
            const avg = a.n ? (a.sum/a.n) : 0;
            return renderScoreBar(ECOM_RATING_LABELS[p], avg, 5);
          }).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Most-Discussed Models</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${topModels.map(({phone,n}) => phone ? `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px;">
              <span style="cursor:pointer;" onclick="goToModel(${phone.model_id})">${phone.model}</span>
              <span class="badge gray">${n}</span>
            </div>` : '').join('')}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">What's New in v0.3</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.7;">
        <b style="color:var(--text);">Real comment data</b> — ${totalComments.toLocaleString('en-IN')} genuine Amazon/Flipkart reviews loaded (up from 348), covering ${new Set(STATE.comments.map(c=>c.model_id)).size} of 58 models.<br>
        <b style="color:var(--text);">Canonical taxonomy</b> — 17 parameters (incl. heating, sound, NFC, processor) and 8 nullable strategic themes, matching the LAVA Social Intelligence Platform Design v2.0 spec exactly — ready to align with Consumer Intelligence once that taxonomy freezes.<br>
        <b style="color:var(--text);">3-state lifecycle</b> — Active (sentiment+price tracked, 0-6mo) → Semi-active (price only, 6-12mo) → Frozen (preserved, 12mo+), replacing the old binary open/closed window.<br>
        <b style="color:var(--text);">Price segments &amp; brand tiers</b> — every model tagged with its price band (budget/entry_mid/mid/upper_mid/premium_mid) and brand tier (1/2/ad-hoc) per the doc's coverage rules.<br>
        <b style="color:var(--text);">Specs Database &amp; Query tab</b> — still here from v0.2, now segment-aware.
      </div>
    </div>
  `;
}

function renderSentBar(label, n, total, cls) {
  const pct = total ? Math.round((n/total)*100) : 0;
  const colorVar = cls === 'pos' ? 'var(--pos)' : cls === 'neg' ? 'var(--neg)' : cls === 'neu' ? 'var(--neu)' : 'var(--text-faint)';
  return `
    <div>
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
        <span style="color:var(--text-dim);">${label}</span>
        <span class="badge ${cls}">${n} · ${pct}%</span>
      </div>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%; background:${colorVar};"></div></div>
    </div>
  `;
}

function renderScoreBar(label, value, max) {
  const pct = Math.min(100, (value/max)*100);
  const color = value >= 4 ? 'var(--pos)' : value >= 3 ? 'var(--neu)' : value > 0 ? 'var(--neg)' : 'var(--text-faint)';
  return `
    <div class="score-bar-wrap">
      <span style="font-size:12px; color:var(--text-dim); width:110px; flex-shrink:0;">${label}</span>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%; background:${color};"></div></div>
      <span class="score-num">${value > 0 ? value.toFixed(1) : '–'}</span>
    </div>
  `;
}
