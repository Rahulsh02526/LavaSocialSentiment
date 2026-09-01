// public/app_product_lab.js
// Product Lab tab — Product Suggester (Feature 1)
// PM enters price + optional specs → platform returns market snapshot,
// consumer buzz, competitive verdict, and AI recommendation.

let productLabState = {
  result: null,
  loading: false,
};

function renderProductLabView() {
  const el = document.getElementById('view-product-lab');
  el.innerHTML = `
    <!-- TAB SWITCHER -->
    <div style="display:flex; gap:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-bottom:20px; width:360px;">
      <button id="ideationTabProduct" onclick="switchIdeationTab('product')"
        style="flex:1; padding:9px 16px; font-size:13px; font-weight:600; background:var(--accent); color:#fff; border:none; cursor:pointer;">
        🔧 Product Ideation
      </button>
      <button id="ideationTabMarketing" onclick="switchIdeationTab('marketing')"
        style="flex:1; padding:9px 16px; font-size:13px; font-weight:600; background:var(--panel); color:var(--text-dim); border:none; cursor:pointer; border-left:1px solid var(--border);">
        🎯 Marketing Ideation
      </button>
    </div>

    <div id="ideationProductPanel">
    <div class="section-head">
      <div>
        <div class="section-title">Ideation Lab</div>
        <div class="section-sub">Product team: enter price/specs to find what wins. Marketing team: get positioning options based on consumer data and competitor messaging.</div>
      </div>
    </div>

    <!-- INPUT PANEL -->
    <div class="panel" style="margin-bottom:18px;">
      <div style="display:grid; grid-template-columns: 200px 200px 1fr auto; gap:14px; align-items:flex-end;">

        <div class="field">
          <label>Target Launch Price (₹) *</label>
          <input type="number" id="pl_price" placeholder="e.g. 15999"
            style="font-size:15px; font-weight:600; color:var(--pos);"
            oninput="updateSegmentBadge()">
        </div>

        <div class="field">
          <label>Platform Focus</label>
          <select id="pl_platform">
            <option value="Online">Online (Amazon / Flipkart)</option>
            <option value="Offline">Offline (Retail)</option>
            <option value="Both">Both</option>
          </select>
        </div>

        <div style="font-size:11px; color:var(--text-faint); padding-bottom:8px;" id="pl_segment_badge"></div>

        <button class="primary" style="padding:8px 20px; margin-bottom:1px;" onclick="runProductSuggester()">
          Analyse →
        </button>
      </div>

      <!-- Proposed specs (collapsible) -->
      <div style="margin-top:12px;">
        <div style="font-size:11px; font-weight:600; color:var(--text-faint); cursor:pointer; display:flex; align-items:center; gap:6px;"
          onclick="toggleSpecsInput()">
          <span id="specsToggleArrow">▶</span>
          <span>Add Proposed Specs (optional — get a personalised verdict)</span>
        </div>
        <div id="specsInputPanel" style="display:none; margin-top:12px;">
          <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:12px;">
            <div class="field"><label>Processor</label><input type="text" id="pl_processor" placeholder="e.g. Unisoc T8200"></div>
            <div class="field"><label>Battery (mAh)</label><input type="number" id="pl_battery" placeholder="e.g. 5000"></div>
            <div class="field"><label>RAM</label><input type="text" id="pl_ram" placeholder="e.g. 6GB"></div>
            <div class="field"><label>Rear Camera</label><input type="text" id="pl_camera" placeholder="e.g. 50MP"></div>
            <div class="field"><label>Display</label><input type="text" id="pl_display" placeholder="e.g. 6.7in FHD+ 120Hz"></div>
            <div class="field"><label>Fast Charging (W)</label><input type="number" id="pl_charging" placeholder="e.g. 45"></div>
            <div class="field"><label>Weight (g)</label><input type="number" id="pl_weight" placeholder="e.g. 185"></div>
            <div class="field"><label>OS</label><input type="text" id="pl_os" placeholder="e.g. Android 15"></div>
            <div class="field"><label>Connectivity</label><input type="text" id="pl_connectivity" placeholder="e.g. 5G, NFC, IP54"></div>
            <div class="field"><label>Storage</label><input type="text" id="pl_storage" placeholder="e.g. 128GB"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- RESULTS -->
    <div id="pl_results"></div>
    </div><!-- /ideationProductPanel -->

    <div id="ideationMarketingPanel" style="display:none;">
      <div id="marketingInner"></div>
    </div>
  `;

  updateSegmentBadge();
  if (productLabState.result) renderProductLabResults(productLabState.result);

  // render marketing panel content
  const mInner = document.getElementById('marketingInner');
  if (mInner) {
    mInner.innerHTML = renderMarketingIdeationPanel() + renderPositioningSection() + renderKVAnalysisSection();
  }
  if (positioningState.result) {
    const r = document.getElementById('pos_results');
    if (r) renderPositioningResults(positioningState.result, r);
  }
  if (positioningState.result) {
    renderPositioningResults(positioningState.result, document.getElementById('pos_results'));
  }
}

function updateSegmentBadge() {
  const price = parseFloat(document.getElementById('pl_price')?.value || 0);
  const badge = document.getElementById('pl_segment_badge');
  if (!badge) return;
  if (!price) { badge.innerHTML = ''; return; }

  const segments = [
    [0, 10000, 'Budget', '<₹10K'],
    [10000, 15000, 'Entry Mid', '₹10–15K'],
    [15000, 20000, 'Mid', '₹15–20K'],
    [20000, 25000, 'Upper Mid', '₹20–25K'],
    [25000, 30000, 'Premium Mid', '₹25–30K'],
  ];
  const seg = segments.find(([lo, hi]) => price >= lo && price < hi);
  if (seg) {
    badge.innerHTML = `<span style="background:rgba(200,16,46,0.15); color:var(--neg); border:1px solid rgba(200,16,46,0.3); border-radius:4px; padding:3px 10px; font-weight:600;">${seg[2]} Segment (${seg[3]})</span>`;
  }
}

function toggleSpecsInput() {
  const panel = document.getElementById('specsInputPanel');
  const arrow = document.getElementById('specsToggleArrow');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  arrow.textContent = isOpen ? '▶' : '▼';
}

async function runProductSuggester() {
  const price = parseFloat(document.getElementById('pl_price')?.value || 0);
  if (!price || price < 1000) {
    alert('Please enter a valid target price (e.g. 15999).');
    return;
  }

  // collect proposed specs
  const proposed_specs = {};
  const specFields = {
    pl_processor: 'processor', pl_battery: 'battery_mah', pl_ram: 'ram',
    pl_camera: 'rear_camera', pl_display: 'display', pl_charging: 'fast_charging_w',
    pl_weight: 'weight_g', pl_os: 'os', pl_connectivity: 'connectivity', pl_storage: 'storage',
  };
  Object.entries(specFields).forEach(([id, key]) => {
    const val = document.getElementById(id)?.value?.trim();
    if (val) proposed_specs[key] = val;
  });

  const resultsEl = document.getElementById('pl_results');
  resultsEl.innerHTML = `
    <div class="panel" style="text-align:center; padding:40px;">
      <span class="spinner" style="font-size:20px;"></span>
      <div style="margin-top:12px; color:var(--text-faint); font-size:13px;">
        Analysing ${STATE.comments.length.toLocaleString('en-IN')} comments across competitors in your price band…
      </div>
    </div>`;

  try {
    const data = await apiPost('/api/product-suggester', {
      target_price: price,
      proposed_specs: Object.keys(proposed_specs).length ? proposed_specs : null,
      platform_focus: document.getElementById('pl_platform')?.value || 'Online',
    });

    productLabState.result = data;
    renderProductLabResults(data);
  } catch (e) {
    resultsEl.innerHTML = `<div class="notice danger">Analysis failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderProductLabResults(data) {
  const el = document.getElementById('pl_results');
  if (!el) return;

  const { target_price, segment, price_band, competitors, buzz, verdict, synthesis, total_comments_analysed } = data;

  // format synthesis markdown-lite
  const fmtSynthesis = (synthesis || '')
    .replace(/## (.+)/g, '<div style="font-size:12px; font-weight:700; color:var(--red); letter-spacing:0.1em; text-transform:uppercase; margin:14px 0 6px;">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  el.innerHTML = `
    <!-- META BAR -->
    <div style="display:flex; gap:12px; margin-bottom:14px; flex-wrap:wrap; align-items:center;">
      <span style="font-size:13px; font-weight:600;">₹${price_band.low.toLocaleString('en-IN')} – ₹${price_band.high.toLocaleString('en-IN')} band</span>
      <span class="badge gray">${competitors.length} competitor${competitors.length===1?'':'s'}</span>
      <span class="badge gray">${total_comments_analysed.toLocaleString('en-IN')} tagged comments</span>
      <span class="badge gray">${segment?.replace('_',' ')} segment</span>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">

      <!-- AI RECOMMENDATION -->
      <div class="panel" style="border-color:rgba(200,16,46,0.4); background:rgba(200,16,46,0.04);">
        <div class="panel-title" style="margin-bottom:12px; color:var(--neg);">🎯 AI Strategic Recommendation</div>
        <div style="font-size:12px; line-height:1.7; color:var(--text-dim);">${fmtSynthesis}</div>
      </div>

      <!-- CONSUMER BUZZ -->
      <div class="panel">
        <div class="panel-title" style="margin-bottom:12px;">📢 Consumer Buzz — What Matters Most</div>
        ${buzz.slice(0,8).map((b, i) => `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <div style="font-size:10px; color:var(--text-faint); width:18px; text-align:right;">${i+1}</div>
            <div style="width:90px; font-size:12px; font-weight:500; flex-shrink:0;">${b.label}</div>
            <div style="flex:1; height:6px; background:var(--panel-2); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${Math.min(100, Math.round(b.mentions / (buzz[0]?.mentions||1) * 100))}%;
                background:${b.positivity >= 65 ? 'var(--pos)' : b.positivity >= 40 ? 'var(--neu)' : 'var(--neg)'};
                border-radius:3px;"></div>
            </div>
            <div style="font-size:11px; font-weight:600; width:36px; color:${b.positivity >= 65 ? 'var(--pos)' : b.positivity >= 40 ? 'var(--neu)' : 'var(--neg)'};">
              ${b.positivity ?? '?'}%
            </div>
            <div style="font-size:10px; color:var(--text-faint); width:60px;">${b.mentions} mentions</div>
          </div>
        `).join('')}
        <div style="font-size:10px; color:var(--text-faint); margin-top:8px;">% = positivity score · bar = relative mention volume</div>
      </div>
    </div>

    <!-- COMPETITOR TABLE -->
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-title" style="margin-bottom:12px;">⚔️ Competitor Snapshot (₹${price_band.low.toLocaleString('en-IN')} – ₹${price_band.high.toLocaleString('en-IN')})</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th class="num">Current ₹</th>
              <th class="num">Launch ₹</th>
              <th>Processor</th>
              <th>Battery</th>
              <th>Display</th>
              <th>Camera</th>
              <th>Battery Sent.</th>
              <th>Camera Sent.</th>
              <th>Performance Sent.</th>
            </tr>
          </thead>
          <tbody>
            ${competitors.map(c => {
              const sp = c.specs || {};
              const bz = c.buzz || {};
              const sentCell = (param) => {
                const d = bz[param];
                if (!d || (d.pos + d.neg) === 0) return '<td class="num" style="color:var(--text-faint);">–</td>';
                const pct = Math.round(d.pos / (d.pos + d.neg) * 100);
                const col = pct >= 65 ? 'var(--pos)' : pct >= 40 ? 'var(--neu)' : 'var(--neg)';
                return `<td class="num" style="color:${col}; font-weight:600;">${pct}%</td>`;
              };
              return `<tr>
                <td style="font-weight:500;">
                  <a href="#" onclick="event.preventDefault(); goToModel(${c.model_id});" style="color:var(--text);">${escapeHtml(c.model)}</a>
                  <div style="font-size:10px; color:var(--text-faint);">${c.brand} · ${c.monthsOld||'?'}mo ago
                    ${c.recencyLabel === 'PRIMARY' ? '<span style="color:var(--pos); font-weight:700;"> ●</span>' :
                      c.recencyLabel === 'RECENT'  ? '<span style="color:var(--neu); font-weight:700;"> ●</span>' :
                      c.recencyLabel === 'ACTIVE'  ? '<span style="color:var(--dim);"> ●</span>' : ''}
                  </div>
                </td>
                <td class="num" style="font-weight:600;">
                  ${Object.entries(c.matchingVariants||{}).length > 0
                    ? Object.entries(c.matchingVariants).map(([label, v]) =>
                        `<div style="white-space:nowrap;"><span style="font-size:10px;color:var(--text-faint);">${escapeHtml(label)}</span> ₹${v.effective_price?.toLocaleString('en-IN')}</div>`
                      ).join('')
                    : '₹' + ((c.effectivePrice||c.current_price_inr||c.launch_price_inr)||0).toLocaleString('en-IN')
                  }
                </td>
                <td class="num" style="font-size:10px; color:var(--text-faint);">₹${(c.launch_price_inr||0).toLocaleString('en-IN')}</td>
                <td style="font-size:11px;">${escapeHtml(sp.processor||'–')}</td>
                <td class="num">${sp.battery_mah ? sp.battery_mah+'mAh' : '–'}</td>
                <td style="font-size:11px;">${escapeHtml(sp.display||'–')}</td>
                <td style="font-size:11px;">${escapeHtml(sp.rear_camera||'–')}</td>
                ${sentCell('battery')}
                ${sentCell('camera_back')}
                ${sentCell('performance')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- VERDICT (if specs proposed) -->
    ${verdict ? `
    <div class="panel" style="border-color:rgba(212,168,71,0.4);">
      <div class="panel-title" style="margin-bottom:12px; color:var(--gold);">📋 Your Proposed Specs — Verdict</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div>
          <div style="font-size:11px; font-weight:600; color:var(--pos); margin-bottom:8px;">✓ STRENGTHS</div>
          ${verdict.strengths.length ? verdict.strengths.map(s => `
            <div style="font-size:12px; margin-bottom:6px; padding:8px 12px; background:rgba(34,197,94,0.08); border-radius:6px; border-left:3px solid var(--pos);">
              ${escapeHtml(s)}
            </div>`).join('') : '<div style="font-size:12px; color:var(--text-faint);">Specs competitive — no major advantages flagged</div>'}
        </div>
        <div>
          <div style="font-size:11px; font-weight:600; color:var(--neg); margin-bottom:8px;">⚠ RISKS</div>
          ${verdict.weaknesses.length ? verdict.weaknesses.map(w => `
            <div style="font-size:12px; margin-bottom:6px; padding:8px 12px; background:rgba(200,16,46,0.08); border-radius:6px; border-left:3px solid var(--neg);">
              ${escapeHtml(w)}
            </div>`).join('') : '<div style="font-size:12px; color:var(--text-faint);">No major risks flagged vs segment</div>'}
        </div>
      </div>
      ${verdict.segment_averages ? `
      <div style="margin-top:12px; font-size:11px; color:var(--text-faint);">
        Segment average battery: ${verdict.segment_averages.battery_mah}mAh · Highest: ${verdict.segment_averages.battery_max}mAh
      </div>` : ''}
    </div>` : `
    <div class="notice" style="font-size:12px;">
      💡 Add your proposed specs above and re-run to get a personalised verdict comparing your product against these competitors.
    </div>`}

    <!-- TOP VERBATIMS -->
    ${buzz.slice(0,3).some(b => b.verbatims?.length) ? `
    <div class="panel" style="margin-top:16px;">
      <div class="panel-title" style="margin-bottom:12px;">💬 What Consumers Are Actually Saying</div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px;">
        ${buzz.slice(0,3).filter(b => b.verbatims?.length).map(b => `
          <div>
            <div style="font-size:10px; font-weight:700; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.1em; margin-bottom:8px;">${b.label}</div>
            ${b.verbatims.map(v => `
              <div style="font-size:11px; color:${v.sentiment==='positive'?'var(--pos)':v.sentiment==='negative'?'var(--neg)':'var(--text-dim)'}; margin-bottom:6px; padding:8px; background:var(--panel-2); border-radius:6px; line-height:1.5;">
                "${escapeHtml((v.text||'').slice(0,100))}${(v.text||'').length>100?'…':''}"
                <div style="font-size:9px; color:var(--text-faint); margin-top:4px;">${v.source}</div>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
    </div>` : ''}
  `;
}

// helper — already defined in app_core.js but guard for safety
if (typeof goToModel === 'undefined') {
  function goToModel(modelId) { switchView('model', modelId); }
}

// ══════════════════════════════════════════════
// BRAND POSITIONING SUGGESTER
// ══════════════════════════════════════════════

let positioningState = { result: null };

function renderPositioningSection() {
  return `
    <div class="panel" style="margin-top:24px;">
      <div class="panel-title" style="margin-bottom:4px;">🎯 Brand Positioning Suggester</div>
      <div style="font-size:12px; color:var(--text-faint); margin-bottom:16px;">Enter product details — platform scans competitor messaging, finds gaps, and suggests positioning options</div>

      <div style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap:14px; margin-bottom:14px;">
        <div class="field">
          <label>Model Name</label>
          <input type="text" id="pos_model" placeholder="e.g. Lava Bold 3 5G">
        </div>
        <div class="field">
          <label>Target Price (₹) *</label>
          <input type="number" id="pos_price" placeholder="e.g. 15999">
        </div>
        <div class="field">
          <label>Platform</label>
          <select id="pos_platform">
            <option value="Online">Online</option>
            <option value="Offline">Offline</option>
            <option value="Both">Both</option>
          </select>
        </div>
        <div style="display:flex; align-items:flex-end; padding-bottom:1px;">
          <button class="primary" style="width:100%;" onclick="runPositioningSuggester()">Get Positioning →</button>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:var(--text-faint); cursor:pointer; display:flex; align-items:center; gap:6px;" onclick="togglePosSpecs()">
          <span id="posSpecsArrow">▶</span>
          <span>Add Specs for sharper recommendations (optional)</span>
        </div>
        <div id="posSpecsPanel" style="display:none; margin-top:10px;">
          <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px;">
            <div class="field"><label>Processor</label><input type="text" id="pos_processor" placeholder="e.g. Dimensity 7400"></div>
            <div class="field"><label>Battery (mAh)</label><input type="number" id="pos_battery" placeholder="e.g. 5500"></div>
            <div class="field"><label>Display</label><input type="text" id="pos_display" placeholder="e.g. 6.67in FHD+ AMOLED"></div>
            <div class="field"><label>Camera</label><input type="text" id="pos_camera" placeholder="e.g. 50MP Sony IMX752"></div>
            <div class="field"><label>Key Feature</label><input type="text" id="pos_feature" placeholder="e.g. Stock Android, IP68"></div>
          </div>
        </div>
      </div>

      <div id="pos_status"></div>
      <div id="pos_results"></div>
    </div>
  `;
}

function togglePosSpecs() {
  const panel = document.getElementById('posSpecsPanel');
  const arrow = document.getElementById('posSpecsArrow');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  arrow.textContent = open ? '▶' : '▼';
}

async function runPositioningSuggester() {
  const price = parseFloat(document.getElementById('pos_price')?.value || 0);
  if (!price || price < 1000) { alert('Please enter a valid target price.'); return; }

  const specs = {};
  const fields = { pos_processor: 'processor', pos_battery: 'battery_mah', pos_display: 'display', pos_camera: 'rear_camera', pos_feature: 'key_feature' };
  Object.entries(fields).forEach(([id, key]) => {
    const val = document.getElementById(id)?.value?.trim();
    if (val) specs[key] = val;
  });

  const statusEl = document.getElementById('pos_status');
  const resultsEl = document.getElementById('pos_results');
  statusEl.innerHTML = `<div class="notice"><span class="spinner"></span> Scanning competitor messaging and finding positioning gaps…</div>`;
  resultsEl.innerHTML = '';

  try {
    const data = await apiPost('/api/product-suggester?action=positioning', {
      model_name:     document.getElementById('pos_model')?.value?.trim() || 'New LAVA Model',
      target_price:   price,
      specs:          Object.keys(specs).length ? specs : null,
      platform_focus: document.getElementById('pos_platform')?.value || 'Online',
      brand:          'LAVA',
    });

    positioningState.result = data;
    statusEl.innerHTML = '';
    renderPositioningResults(data, resultsEl);
  } catch (e) {
    statusEl.innerHTML = `<div class="notice danger">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function renderPositioningResults(data, el) {
  const { price_band, competitors, gaps, positioning, total_comments_analysed } = data;

  // parse positioning markdown into styled sections
  const fmtPositioning = (positioning || '')
    .replace(/## OPTION ([A-C]): (.+)/g, (_, letter, title) =>
      `<div style="margin-top:16px; padding:14px 16px; background:var(--panel-2); border-radius:8px; border-left:3px solid var(--accent);">
        <div style="font-size:10px; font-weight:700; color:var(--accent); letter-spacing:0.1em; margin-bottom:6px;">OPTION ${letter}</div>
        <div style="font-size:14px; font-weight:700; margin-bottom:10px; color:var(--text);">${title}</div>`)
    .replace(/## RECOMMENDED: (.+)/g,
      `</div><div style="margin-top:16px; padding:14px 16px; background:rgba(34,197,94,0.08); border-radius:8px; border-left:3px solid var(--pos);">
        <div style="font-size:10px; font-weight:700; color:var(--pos); letter-spacing:0.1em; margin-bottom:6px;">⭐ RECOMMENDED</div>
        <div style="font-size:13px; font-weight:600; color:var(--pos); margin-bottom:8px;">$1</div>`)
    .replace(/## WHAT TO AVOID/g,
      `</div><div style="margin-top:16px; padding:14px 16px; background:rgba(200,16,46,0.06); border-radius:8px; border-left:3px solid var(--neg);">
        <div style="font-size:10px; font-weight:700; color:var(--neg); letter-spacing:0.1em; margin-bottom:8px;">⚠ WHAT TO AVOID</div>`)
    .replace(/\*\*Tagline:\*\* "(.+?)"/g, `<div style="font-size:16px; font-style:italic; color:var(--pos); margin:6px 0 10px; font-weight:600;">"$1"</div>`)
    .replace(/\*\*(.+?):\*\*/g, `<span style="font-weight:700; color:var(--text);">$1:</span>`)
    .replace(/\n/g, '<br>');

  el.innerHTML = `
    <!-- META -->
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; align-items:center;">
      <span style="font-size:12px; font-weight:600;">₹${price_band.low.toLocaleString('en-IN')} – ₹${price_band.high.toLocaleString('en-IN')} band</span>
      <span class="badge gray">${competitors.length} competitors scanned</span>
      <span class="badge gray">${total_comments_analysed.toLocaleString('en-IN')} comments analysed</span>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">

      <!-- POSITIONING OPTIONS -->
      <div>
        <div style="font-size:11px; font-weight:700; color:var(--text-faint); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:4px;">Positioning Options</div>
        <div style="font-size:13px; line-height:1.7; color:var(--text-dim);">${fmtPositioning}</div>
      </div>

      <!-- GAPS + COMPETITOR SCAN -->
      <div>
        <div style="font-size:11px; font-weight:700; color:var(--text-faint); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:8px;">Consumer Sentiment Gaps</div>
        ${gaps.slice(0,6).map(g => `
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
            <div style="width:110px; font-size:12px; flex-shrink:0; color:${g.is_gap ? 'var(--neg)' : 'var(--text-dim)'}; font-weight:${g.is_gap ? '600' : '400'};">${g.label}${g.is_gap ? ' ⚡' : ''}</div>
            <div style="flex:1; height:5px; background:var(--panel-2); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${g.positivity ?? 0}%; background:${(g.positivity||0) >= 65 ? 'var(--pos)' : (g.positivity||0) >= 40 ? 'var(--neu)' : 'var(--neg)'}; border-radius:3px;"></div>
            </div>
            <div style="font-size:11px; font-weight:600; width:36px; color:${(g.positivity||0) >= 65 ? 'var(--pos)' : (g.positivity||0) >= 40 ? 'var(--neu)' : 'var(--neg)'};">${g.positivity ?? '?'}%</div>
            <div style="font-size:10px; color:var(--text-faint); width:60px;">${g.mentions} mentions</div>
          </div>`).join('')}
        <div style="font-size:10px; color:var(--text-faint); margin-top:4px;">⚡ = high frustration gap = messaging opportunity</div>

        <div style="margin-top:14px;">
          <div style="font-size:11px; font-weight:700; color:var(--text-faint); letter-spacing:0.1em; text-transform:uppercase; margin-bottom:8px;">Competitor Official Messaging</div>
          ${competitors.filter(c => c.official_video_title).slice(0,5).map(c => `
            <div style="margin-bottom:6px; padding:6px 10px; background:var(--panel-2); border-radius:5px;">
              <div style="font-size:10px; color:var(--text-faint); margin-bottom:2px;">${c.brand} · ₹${(c.price||0).toLocaleString('en-IN')}</div>
              <div style="font-size:11px; color:var(--text-dim);">${escapeHtml(c.official_video_title||'')}</div>
            </div>`).join('') || '<div style="font-size:11px; color:var(--text-faint);">No official video messaging data available yet</div>'}
        </div>
      </div>
    </div>
  `;
}

// ── TAB SWITCHER ──
function switchIdeationTab(tab) {
  const productPanel   = document.getElementById('ideationProductPanel');
  const marketingPanel = document.getElementById('ideationMarketingPanel');
  const productBtn     = document.getElementById('ideationTabProduct');
  const marketingBtn   = document.getElementById('ideationTabMarketing');

  if (tab === 'product') {
    if (productPanel)   productPanel.style.display   = 'block';
    if (marketingPanel) marketingPanel.style.display = 'none';
    if (productBtn)   { productBtn.style.background   = 'var(--accent)'; productBtn.style.color   = '#fff'; }
    if (marketingBtn) { marketingBtn.style.background = 'var(--panel)';  marketingBtn.style.color = 'var(--text-dim)'; }
  } else {
    if (productPanel)   productPanel.style.display   = 'none';
    if (marketingPanel) marketingPanel.style.display = 'block';
    if (marketingBtn) { marketingBtn.style.background = 'var(--accent)'; marketingBtn.style.color   = '#fff'; }
    if (productBtn)   { productBtn.style.background   = 'var(--panel)';  productBtn.style.color = 'var(--text-dim)'; }
  }
}

function renderMarketingIdeationPanel() {
  return `
    <div class="section-head">
      <div>
        <div class="section-title">Marketing Ideation</div>
        <div class="section-sub">Get positioning options based on consumer data · Analyse competitor KVs for messaging intelligence</div>
      </div>
    </div>
  `;
}

// ── KV VISION ANALYSIS ──
function renderKVAnalysisSection() {
  return `
    <div class="panel" style="margin-top:20px;">
      <div class="panel-title" style="margin-bottom:4px;">🖼 KV / Creative Analysis</div>
      <div style="font-size:12px; color:var(--text-faint); margin-bottom:16px;">
        Paste a KV image URL (from Supabase Storage or any public URL) — AI will analyse the creative's positioning, messaging, emotion, and what it communicates to consumers.
      </div>

      <div style="display:grid; grid-template-columns:1fr 200px auto; gap:12px; align-items:flex-end; margin-bottom:12px;">
        <div class="field" style="margin:0;">
          <label>KV / Creative Image URL</label>
          <input type="text" id="kv_url" placeholder="https://...supabase.co/.../hmd-vibe-2-kv1.png">
        </div>
        <div class="field" style="margin:0;">
          <label>Brand / Model (optional)</label>
          <input type="text" id="kv_brand" placeholder="e.g. HMD Vibe 2 5G">
        </div>
        <button class="primary" style="margin-bottom:1px;" onclick="runKVAnalysis()">Analyse →</button>
      </div>

      <!-- Quick load from existing assets -->
      <div style="font-size:11px; color:var(--text-faint); margin-bottom:12px;">
        Or pick from mapped assets:
        <select id="kv_assetPicker" onchange="loadKVFromAssets()" style="margin-left:8px; font-size:11px;">
          <option value="">Select a model's KV...</option>
          ${(STATE.phones || []).flatMap(p => {
            const assets = (STATE.marketingAssets?.[p.model_id] || []).filter(a => a.type === 'kv' && a.url);
            return assets.map(a => `<option value="${escapeHtml(a.url)}|${escapeHtml(p.model)}">${p.model} — ${a.campaign_name||'KV'}</option>`);
          }).join('')}
        </select>
      </div>

      <div id="kv_status"></div>
      <div id="kv_results"></div>
    </div>
  `;
}

function loadKVFromAssets() {
  const picker = document.getElementById('kv_assetPicker');
  const val = picker?.value;
  if (!val) return;
  const [url, model] = val.split('|');
  const urlInput   = document.getElementById('kv_url');
  const brandInput = document.getElementById('kv_brand');
  if (urlInput)   urlInput.value   = url;
  if (brandInput) brandInput.value = model;
}

async function runKVAnalysis() {
  const url   = document.getElementById('kv_url')?.value?.trim();
  const brand = document.getElementById('kv_brand')?.value?.trim();
  const statusEl  = document.getElementById('kv_status');
  const resultsEl = document.getElementById('kv_results');

  if (!url || !url.startsWith('http')) { alert('Please paste a valid image URL starting with https://'); return; }

  statusEl.innerHTML  = `<div class="notice"><span class="spinner"></span> Analysing creative with AI vision...</div>`;
  resultsEl.innerHTML = '';

  try {
    const data = await apiPost('/api/product-suggester?action=kv-analysis', { url, brand });
    statusEl.innerHTML = '';
    resultsEl.innerHTML = `
      <div style="display:grid; grid-template-columns:280px 1fr; gap:16px; margin-top:12px;">
        <div>
          <img src="${escapeHtml(url)}" alt="KV" style="width:100%; border-radius:8px; border:1px solid var(--border);"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <div style="display:none; padding:20px; text-align:center; color:var(--text-faint); font-size:12px; background:var(--panel-2); border-radius:8px;">Could not load image</div>
          ${brand ? `<div style="font-size:11px; color:var(--text-faint); margin-top:6px; text-align:center;">${escapeHtml(brand)}</div>` : ''}
        </div>
        <div class="panel" style="margin:0;">
          <div class="panel-title" style="margin-bottom:12px; color:var(--accent);">🎯 AI Creative Analysis</div>
          <div style="font-size:13px; line-height:1.75; color:var(--text-dim);">
            ${(data.analysis || '').replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text);">$1</strong>').replace(/\n/g, '<br>')}
          </div>
        </div>
      </div>
    `;
  } catch(e) {
    statusEl.innerHTML = `<div class="notice danger">Analysis failed: ${escapeHtml(e.message)}</div>`;
  }
}
