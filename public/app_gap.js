// ============================================================
// GAP ANALYSIS VIEW — Module 6
// Pre-launch product definition tool: which parameters are weak across brands in a segment?
// ============================================================

let gapSegmentFilter = 'entry_mid';

function renderGapView() {
  const el = document.getElementById('view-gap');
  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Gap Analysis</div>
        <div class="section-sub">Pre-launch opportunity finder — which parameters are poorly rated across competitors in a segment?</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:14px;">
      <div class="panel-title">Segment</div>
      <div class="pill-row">
        ${Object.entries(PRICE_SEGMENT_LABELS).map(([k,v]) => `<span class="pill ${gapSegmentFilter===k?'active':''}" onclick="setGapSegment('${k}')">${v}</span>`).join('')}
      </div>
    </div>

    <div id="gapResultsBox"></div>
  `;
  renderGapResults();
}

function setGapSegment(seg) {
  gapSegmentFilter = seg;
  renderGapResults();
}

function renderGapResults() {
  const box = document.getElementById('gapResultsBox');
  const models = STATE.phones.filter(p => p.price_segment === gapSegmentFilter && getLifecycleStatus(p) !== 'frozen');

  if (models.length === 0) {
    box.innerHTML = `<div class="empty-state"><div class="title">No active models in this segment</div></div>`;
    return;
  }

  // for each parameter, compute positivity % per model, then flag params where most models score < 50%
  const paramModelScores = {}; // param -> [{model, positivity, n}]
  PARAMS.forEach(param => { paramModelScores[param] = []; });

  models.forEach(p => {
    const tagged = STATE.comments.filter(c => c.model_id === p.model_id && c.tag && isWithinWindow(p, c.comment_date));
    PARAMS.forEach(param => {
      let pos = 0, neg = 0;
      tagged.forEach(c => (c.tag.mentions||[]).forEach(m => {
        if (m.parameter === param) {
          if (m.sentiment === 'positive') pos++;
          else if (m.sentiment === 'negative') neg++;
        }
      }));
      const n = pos + neg;
      if (n > 0) {
        paramModelScores[param].push({ model: p.model, model_id: p.model_id, positivity: Math.round((pos/n)*100), n });
      }
    });
  });

  // gap = parameter has >=2 models with data AND majority (or all) score below 50%
  const gaps = [];
  Object.entries(paramModelScores).forEach(([param, scores]) => {
    if (scores.length < 2) return;
    const weakCount = scores.filter(s => s.positivity < 50).length;
    if (weakCount / scores.length >= 0.5) {
      gaps.push({ param, scores, weakCount, totalWithData: scores.length });
    }
  });
  gaps.sort((a,b) => (b.weakCount/b.totalWithData) - (a.weakCount/a.totalWithData));

  if (gaps.length === 0) {
    box.innerHTML = `<div class="empty-state"><div class="title">No clear gaps found</div><div class="desc">Either not enough tagged data yet for this segment, or no parameter is weak across the majority of models. Try tagging more comments first.</div></div>`;
    return;
  }

  box.innerHTML = `
    <div class="notice">
      <b>${gaps.length} opportunity gap${gaps.length===1?'':'s'} found</b> in ${PRICE_SEGMENT_LABELS[gapSegmentFilter]} — parameters where most tracked models score below 50% positivity, based on ${models.length} models with tagged comment data.
    </div>
    ${gaps.map(g => `
      <div class="panel">
        <div class="panel-title">${PARAM_LABELS[g.param]} — weak across ${g.weakCount}/${g.totalWithData} models</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Model</th><th>Positivity</th><th>Mentions</th></tr></thead>
            <tbody>
              ${g.scores.sort((a,b)=>a.positivity-b.positivity).map(s => `
                <tr>
                  <td class="model-name"><a href="#" onclick="event.preventDefault(); goToModel(${s.model_id})">${escapeHtml(s.model)}</a></td>
                  <td>
                    <div class="score-bar-wrap">
                      <div class="score-bar-track" style="max-width:140px;"><div class="score-bar-fill" style="width:${s.positivity}%; background:${s.positivity<50?'var(--neg)':'var(--pos)'};"></div></div>
                      <span class="score-num">${s.positivity}%</span>
                    </div>
                  </td>
                  <td class="num">${s.n}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:10px; font-size:12px; color:var(--text-dim);">
          <b style="color:var(--accent);">Opportunity:</b> ${PARAM_LABELS[g.param]} is poorly rated across ${g.weakCount} of ${g.totalWithData} competitors in this segment — a LAVA launch with a genuinely strong ${PARAM_LABELS[g.param].toLowerCase()} story here could stand out.
        </div>
      </div>
    `).join('')}
  `;
}
