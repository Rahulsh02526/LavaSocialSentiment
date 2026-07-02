// public/app_tagging.js
// ============================================================
// TAGGING ENGINE (Vercel build) — calls /api/tag, which holds the real
// Claude key server-side. No key handling in the browser at all.
// ============================================================

let taggingInProgress = false;
let taggingProgress = { done: 0, total: 0 };

function renderTaggingView() {
  const el = document.getElementById('view-tagging');
  const untagged = STATE.comments.filter(c => !c.tag);
  const tagged = STATE.comments.filter(c => c.tag);

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Tagging Engine</div>
        <div class="section-sub">4-Layer Framework: Sentiment → Parameters → Narratives → Strategic Themes</div>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:18px;">
      <div class="kpi">
        <div class="kpi-label">Tagged</div>
        <div class="kpi-value">${tagged.length}</div>
        <div class="kpi-sub">stored permanently in Supabase</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Untagged</div>
        <div class="kpi-value">${untagged.length}</div>
        <div class="kpi-sub">waiting to be processed</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Source Breakdown (untagged)</div>
        <div class="kpi-value" style="font-size:14px; font-family:var(--sans); font-weight:500;">
          ${Object.entries(untagged.reduce((acc,c)=>{acc[c.source]=(acc[c.source]||0)+1; return acc;},{})).map(([s,n])=>`${s}: ${n}`).join(' · ') || '—'}
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Run Tagging</div>
      <div class="notice">
        Comments are batched (25 at a time) and sent to <code>/api/tag</code>, which calls Claude server-side and writes results straight to Supabase. Running this again only processes comments that don't already have a tag row.
        ${!isAdminLoggedIn() ? '<br><span style="color:var(--neu);">Admin login required to run tagging.</span>' : ''}
      </div>
      <div style="display:flex; gap:10px; align-items:center; margin-top:10px;">
        <button class="primary" onclick="${isAdminLoggedIn() ? 'runTagging()' : 'promptAdminLoginRedirect()'}" ${untagged.length===0||taggingInProgress?'disabled':''} id="runTagBtn">
          ${taggingInProgress ? '<span class="spinner"></span> Tagging...' : (isAdminLoggedIn() ? `Tag ${untagged.length} New Comment${untagged.length===1?'':'s'}` : 'Admin Login Required')}
        </button>
        ${untagged.length===0 ? '<span style="font-size:12px; color:var(--text-faint);">All caught up — nothing to tag.</span>' : ''}
      </div>
      <div id="taggingProgressBox" style="display:${taggingInProgress?'block':'none'};">
        <div class="progress-track"><div class="progress-fill" id="taggingProgressFill" style="width:0%;"></div></div>
        <div style="font-size:11px; color:var(--text-faint); margin-top:5px;" id="taggingProgressLabel"></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Recently Tagged</div>
      <div id="recentTaggedBox">${renderRecentTagged()}</div>
    </div>
  `;
}

function renderRecentTagged() {
  const tagged = STATE.comments.filter(c => c.tag).slice(-12).reverse();
  if (!tagged.length) return `<div class="empty-state"><div class="title">Nothing tagged yet</div></div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Model</th><th>Source</th><th>Comment</th><th>Sentiment</th><th>Narrative</th><th>Theme</th></tr></thead>
        <tbody>
          ${tagged.map(c => {
            const phone = STATE.phones.find(p => p.model_id === c.model_id);
            return `<tr>
              <td class="model-name">${phone ? phone.model : c.model_id}</td>
              <td><span class="src-badge ${c.source.toLowerCase()}">${c.source}</span></td>
              <td style="max-width:260px; white-space:normal; font-size:12px; color:var(--text-dim);">${escapeHtml(c.comment_text.slice(0,100))}${c.comment_text.length>100?'…':''}</td>
              <td>${sentBadge(c.tag.sentiment)}</td>
              <td style="font-size:12px; white-space:normal; max-width:160px;">${escapeHtml(c.tag.narrative||'–')}</td>
              <td style="font-size:11px; color:var(--text-faint);">${c.tag.strategic_theme ? c.tag.strategic_theme.replace(/_/g,' ') : '–'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function sentBadge(s) {
  const cls = s === 'positive' ? 'pos' : s === 'negative' ? 'neg' : s === 'mixed' ? 'neu' : 'gray';
  return `<span class="badge ${cls}">${s||'?'}</span>`;
}

async function runTagging() {
  if (taggingInProgress) return;
  const untagged = STATE.comments.filter(c => !c.tag);
  if (untagged.length === 0) return;

  taggingInProgress = true;
  taggingProgress = { done: 0, total: untagged.length };
  document.getElementById('runTagBtn').disabled = true;
  document.getElementById('runTagBtn').innerHTML = '<span class="spinner"></span> Tagging...';
  document.getElementById('taggingProgressBox').style.display = 'block';

  const BATCH_SIZE = 25;
  const batches = [];
  for (let i = 0; i < untagged.length; i += BATCH_SIZE) batches.push(untagged.slice(i, i+BATCH_SIZE));

  let failedBatches = 0;
  for (const batch of batches) {
    try {
      const result = await apiPost('/api/tag', { comments: batch.map(c => ({ id: c.id, comment_text: c.comment_text })) });
      for (let i = 0; i < batch.length; i++) {
        batch[i].tag = result.tags[i];
      }
    } catch (e) {
      console.error('Batch tagging failed:', e);
      failedBatches++;
    }
    taggingProgress.done += batch.length;
    const pct = Math.round((taggingProgress.done / taggingProgress.total) * 100);
    const fill = document.getElementById('taggingProgressFill');
    const label = document.getElementById('taggingProgressLabel');
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = `${taggingProgress.done} / ${taggingProgress.total} comments processed`;
  }

  taggingInProgress = false;
  renderTopbar();
  renderTaggingView();
  renderOverview();
  if (failedBatches > 0) {
    alert(`Tagging finished with ${failedBatches} batch(es) failed — those comments remain untagged. Click "Tag" again to retry just those.`);
  }
}
