// public/app_admin.js
// Admin Panel tab — Add New Model form, model management, price updates.
// Only accessible when admin is logged in.

function renderAdminView() {
  const el = document.getElementById('view-admin');
  if (!isAdminLoggedIn()) {
    el.innerHTML = `
      <div class="empty-state" style="padding:60px 0;">
        <div class="title">Admin Access Required</div>
        <div class="desc">Log in as admin to access this panel.</div>
        <button class="primary" style="margin-top:16px;" onclick="window.open('/admin.html','_blank')">Admin Login</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="section-head">
      <div>
        <div class="section-title">Admin Panel</div>
        <div class="section-sub">Add models, update prices, manage platform data</div>
      </div>
    </div>

    <!-- ADD NEW MODEL -->
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-title" style="margin-bottom:16px;">➕ Add New Model</div>
      <div id="addModelStatus"></div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px;">

        <!-- Basic Info -->
        <div style="grid-column:1/-1;">
          <div style="font-size:11px; font-weight:700; letter-spacing:0.1em; color:var(--text-faint); text-transform:uppercase; margin-bottom:10px;">Basic Information</div>
        </div>

        <div class="field">
          <label>Model Name *</label>
          <input type="text" id="am_model" placeholder="e.g. Lava Bold 3 5G">
        </div>
        <div class="field">
          <label>Brand *</label>
          <select id="am_brand">
            <option value="">Select brand</option>
            ${['lava','samsung','realme','redmi','xiaomi','poco','iqoo','vivo','oneplus','motorola','nokia','tecno','itel','infinix','oppo','hmd','ai+'].map(b => `<option value="${b}">${b.charAt(0).toUpperCase()+b.slice(1)}</option>`).join('')}
            <option value="_other">Other (type below)</option>
          </select>
        </div>
        <div class="field" id="am_brand_other_wrap" style="display:none;">
          <label>Brand Name (custom)</label>
          <input type="text" id="am_brand_other" placeholder="e.g. Nothing">
        </div>

        <div class="field">
          <label>Launch Date *</label>
          <input type="date" id="am_launch_date">
        </div>
        <div class="field">
          <label>Launch Price (₹) *</label>
          <input type="number" id="am_price" placeholder="e.g. 14999">
        </div>
        <div class="field">
          <label>Price Segment</label>
          <select id="am_segment">
            <option value="">Auto-detect from price</option>
            <option value="budget">Budget (&lt;₹10K)</option>
            <option value="entry_mid">Entry Mid (₹10–15K)</option>
            <option value="mid">Mid (₹15–20K)</option>
            <option value="upper_mid">Upper Mid (₹20–25K)</option>
            <option value="premium_mid">Premium Mid (₹25–30K)</option>
          </select>
        </div>

        <div class="field">
          <label>Available on Amazon?</label>
          <select id="am_amazon">
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </div>
        <div class="field">
          <label>Available on Flipkart?</label>
          <select id="am_flipkart">
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        </div>
        <div></div>

        <!-- Specs -->
        <div style="grid-column:1/-1; margin-top:8px;">
          <div style="font-size:11px; font-weight:700; letter-spacing:0.1em; color:var(--text-faint); text-transform:uppercase; margin-bottom:10px;">Specifications <span style="font-weight:400; color:var(--text-faint);">(optional but recommended)</span></div>
        </div>

        <div class="field">
          <label>Processor</label>
          <input type="text" id="am_processor" placeholder="e.g. Unisoc T8200 (6nm)">
        </div>
        <div class="field">
          <label>RAM Variants</label>
          <input type="text" id="am_ram" placeholder="e.g. 4GB, 6GB, 8GB (comma separated)">
        </div>
        <div class="field">
          <label>Storage Variants</label>
          <input type="text" id="am_storage" placeholder="e.g. 128GB, 256GB (comma separated)">
        </div>

        <div class="field">
          <label>Display</label>
          <input type="text" id="am_display" placeholder="e.g. 6.7in FHD+ AMOLED 120Hz">
        </div>
        <div class="field">
          <label>Battery (mAh)</label>
          <input type="number" id="am_battery" placeholder="e.g. 5000">
        </div>
        <div class="field">
          <label>Fast Charging (W)</label>
          <input type="number" id="am_charging" placeholder="e.g. 45">
        </div>

        <div class="field">
          <label>Rear Camera</label>
          <input type="text" id="am_rear_cam" placeholder="e.g. 50MP+8MP+2MP">
        </div>
        <div class="field">
          <label>Front Camera</label>
          <input type="text" id="am_front_cam" placeholder="e.g. 16MP">
        </div>
        <div class="field">
          <label>OS</label>
          <input type="text" id="am_os" placeholder="e.g. Android 15">
        </div>

        <div class="field">
          <label>Connectivity</label>
          <input type="text" id="am_connectivity" placeholder="e.g. 5G, NFC, IP54">
        </div>
        <div class="field">
          <label>Weight (g)</label>
          <input type="number" id="am_weight" placeholder="e.g. 185">
        </div>
        <div></div>

      </div>

      <div style="margin-top:18px; display:flex; gap:10px; align-items:center;">
        <button class="primary" onclick="submitAddModel()">Add Model to Platform</button>
        <button class="ghost" onclick="clearAddModelForm()">Clear</button>
      </div>
    </div>

    <!-- EXCEL UPLOAD: NEW MODELS -->
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-title" style="margin-bottom:4px;">📊 Bulk Add Models via Excel</div>
      <div style="font-size:12px; color:var(--text-faint); margin-bottom:14px;">Upload the SIP Model Upload Template. Preview before committing.</div>
      <div id="modelUploadStatus"></div>
      <div style="display:flex; gap:12px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
        <input type="file" id="modelXlsx" accept=".xlsx,.xls" style="font-size:12px; color:var(--text-dim);">
        <button class="small primary" onclick="parseModelXlsx()">Preview</button>
        <a href="#" onclick="event.preventDefault(); downloadModelTemplate()" style="font-size:11px; color:var(--accent);">⬇ Download Template</a>
      </div>
      <div id="modelPreview"></div>
    </div>

    <!-- EXCEL UPLOAD: E-COM RATINGS -->
    <div class="panel" style="margin-bottom:20px;">
      <div class="panel-title" style="margin-bottom:4px;">⭐ Bulk Update E-com Ratings via Excel</div>
      <div style="font-size:12px; color:var(--text-faint); margin-bottom:14px;">Upload the SIP E-com Ratings Template. Model names must match exactly.</div>
      <div id="ratingsUploadStatus"></div>
      <div style="display:flex; gap:12px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
        <input type="file" id="ratingsXlsx" accept=".xlsx,.xls" style="font-size:12px; color:var(--text-dim);">
        <button class="small primary" onclick="parseRatingsXlsx()">Preview</button>
        <a href="#" onclick="event.preventDefault(); downloadRatingsTemplate()" style="font-size:11px; color:var(--accent);">⬇ Download Template</a>
      </div>
      <div id="ratingsPreview"></div>
    </div>

    <!-- PRICE UPDATE (single model) -->
    <div class="panel">
      <div class="panel-title" style="margin-bottom:16px;">💰 Update Current Price (Single Model)</div>
      <div style="font-size:12px; color:var(--text-faint); margin-bottom:14px;">Update the current market price for any model. A price history entry is automatically created.</div>
      <div id="priceUpdateStatus"></div>
      <div style="display:flex; gap:12px; align-items:flex-end; flex-wrap:wrap;">
        <div class="field" style="flex:1; min-width:200px;">
          <label>Model</label>
          <select id="pu_model">
            <option value="">Select model...</option>
            ${(STATE.phones || []).sort((a,b) => a.model.localeCompare(b.model)).map(p => `<option value="${p.model_id}">${p.model}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="width:160px;">
          <label>New Price (₹)</label>
          <input type="number" id="pu_price" placeholder="e.g. 13999">
        </div>
        <div class="field" style="width:180px;">
          <label>Source</label>
          <select id="pu_source">
            <option value="amazon">Amazon</option>
            <option value="flipkart">Flipkart</option>
            <option value="brand_site">Brand Website</option>
            <option value="other">Other</option>
          </select>
        </div>
        <button class="primary" style="margin-bottom:1px;" onclick="submitPriceUpdate()">Update Price</button>
      </div>
    </div>
  `;

  // brand other toggle
  document.getElementById('am_brand').addEventListener('change', function() {
    document.getElementById('am_brand_other_wrap').style.display = this.value === '_other' ? 'block' : 'none';
  });
}

// ── Excel Upload: Models ──
const MODEL_COLUMNS = ['model','brand','launch_date','launch_price_inr','price_segment',
  'amazon_available','flipkart_available','processor','ram_variants','storage_variants',
  'display','battery_mah','fast_charging_w','rear_camera','front_camera','os','connectivity','weight_g'];

async function parseModelXlsx() {
  const file = document.getElementById('modelXlsx').files[0];
  if (!file) { alert('Please select an Excel file first.'); return; }
  const status = document.getElementById('modelUploadStatus');
  const preview = document.getElementById('modelPreview');
  status.innerHTML = `<div class="notice"><span class="spinner"></span> Parsing...</div>`;
  preview.innerHTML = '';

  try {
    const rows = await parseXlsxFile(file, MODEL_COLUMNS);
    if (!rows.length) { status.innerHTML = `<div class="notice danger">No data rows found (make sure data starts from row 3).</div>`; return; }

    status.innerHTML = `<div class="notice">${rows.length} row(s) ready to upload. Review below, then confirm.</div>`;
    preview.innerHTML = `
      <div class="table-wrap" style="max-height:320px; overflow-y:auto; margin-bottom:12px;">
        <table>
          <thead><tr><th>#</th><th>Model</th><th>Brand</th><th>Launch Date</th><th>Price ₹</th><th>Segment</th><th>Amazon</th><th>Flipkart</th><th>Processor</th><th>Battery</th><th>OS</th></tr></thead>
          <tbody>
            ${rows.map((r,i) => `<tr>
              <td>${i+1}</td>
              <td style="font-weight:500;">${escapeHtml(r.model||'')}</td>
              <td>${escapeHtml(r.brand||'')}</td>
              <td>${escapeHtml(r.launch_date||'')}</td>
              <td class="num">₹${parseFloat(r.launch_price_inr||0).toLocaleString('en-IN')}</td>
              <td>${escapeHtml(r.price_segment||'auto')}</td>
              <td>${escapeHtml(r.amazon_available||'No')}</td>
              <td>${escapeHtml(r.flipkart_available||'No')}</td>
              <td style="font-size:10px;">${escapeHtml(r.processor||'–')}</td>
              <td>${r.battery_mah||'–'}</td>
              <td style="font-size:10px;">${escapeHtml(r.os||'–')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <button class="primary" onclick="submitModelUpload(${JSON.stringify(rows).replace(/"/g,'&quot;')})">✓ Upload ${rows.length} Model(s)</button>
      <button class="ghost" style="margin-left:8px;" onclick="document.getElementById('modelPreview').innerHTML=''; document.getElementById('modelUploadStatus').innerHTML='';">Cancel</button>
    `;
  } catch(e) {
    status.innerHTML = `<div class="notice danger">Parse error: ${escapeHtml(e.message)}</div>`;
  }
}

async function submitModelUpload(rows) {
  const status = document.getElementById('modelUploadStatus');
  status.innerHTML = `<div class="notice"><span class="spinner"></span> Uploading ${rows.length} models...</div>`;
  try {
    const result = await apiPost('/api/bulk-add-models', { rows });
    status.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos);">✓ ${escapeHtml(result.message)}</div>`;
    if (result.errors?.length) {
      status.innerHTML += `<div class="notice danger" style="margin-top:6px;">${result.errors.map(e => escapeHtml(e)).join('<br>')}</div>`;
    }
    document.getElementById('modelPreview').innerHTML = '';
    // refresh STATE
    const fresh = await apiGet('/api/data');
    STATE.phones = fresh.phones; STATE.specs = fresh.specs;
    renderTopbar(); renderAdminView();
  } catch(e) {
    status.innerHTML = `<div class="notice danger">Upload failed: ${escapeHtml(e.message)}</div>`;
  }
}

// ── Excel Upload: E-com Ratings ──
const RATINGS_COLUMNS = ['model','source','ecom_rating','num_reviews','noted_date'];

async function parseRatingsXlsx() {
  const file = document.getElementById('ratingsXlsx').files[0];
  if (!file) { alert('Please select an Excel file first.'); return; }
  const status  = document.getElementById('ratingsUploadStatus');
  const preview = document.getElementById('ratingsPreview');
  status.innerHTML = `<div class="notice"><span class="spinner"></span> Parsing...</div>`;
  preview.innerHTML = '';

  try {
    const rows = await parseXlsxFile(file, RATINGS_COLUMNS);
    if (!rows.length) { status.innerHTML = `<div class="notice danger">No data rows found.</div>`; return; }

    status.innerHTML = `<div class="notice">${rows.length} rating(s) ready to upload.</div>`;
    preview.innerHTML = `
      <div class="table-wrap" style="max-height:260px; overflow-y:auto; margin-bottom:12px;">
        <table>
          <thead><tr><th>#</th><th>Model</th><th>Source</th><th>Rating</th><th>Reviews</th><th>Date</th></tr></thead>
          <tbody>
            ${rows.map((r,i) => `<tr>
              <td>${i+1}</td>
              <td style="font-weight:500;">${escapeHtml(r.model||'')}</td>
              <td>${escapeHtml(r.source||'')}</td>
              <td class="num" style="color:var(--gold);">${r.ecom_rating||'–'}</td>
              <td class="num">${r.num_reviews||'–'}</td>
              <td>${escapeHtml(r.noted_date||'')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <button class="primary" onclick="submitRatingsUpload(${JSON.stringify(rows).replace(/"/g,'&quot;')})">✓ Update ${rows.length} Rating(s)</button>
      <button class="ghost" style="margin-left:8px;" onclick="document.getElementById('ratingsPreview').innerHTML=''; document.getElementById('ratingsUploadStatus').innerHTML='';">Cancel</button>
    `;
  } catch(e) {
    status.innerHTML = `<div class="notice danger">Parse error: ${escapeHtml(e.message)}</div>`;
  }
}

async function submitRatingsUpload(rows) {
  const status = document.getElementById('ratingsUploadStatus');
  status.innerHTML = `<div class="notice"><span class="spinner"></span> Updating ${rows.length} ratings...</div>`;
  try {
    const result = await apiPost('/api/bulk-update-ratings', { rows });
    status.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos);">✓ ${escapeHtml(result.message)}</div>`;
    if (result.errors?.length) {
      status.innerHTML += `<div class="notice danger" style="margin-top:6px;">${result.errors.map(e => escapeHtml(e)).join('<br>')}</div>`;
    }
    document.getElementById('ratingsPreview').innerHTML = '';
  } catch(e) {
    status.innerHTML = `<div class="notice danger">Upload failed: ${escapeHtml(e.message)}</div>`;
  }
}

// ── Core XLSX parser (uses SheetJS loaded in index.html) ──
function parseXlsxFile(file, columnKeys) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // find header row (row that contains first column key or its label)
        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(raw.length, 5); i++) {
          const rowLower = raw[i].map(c => String(c).toLowerCase());
          if (rowLower.some(c => columnKeys[0] === c || c.includes('model name') || c.includes('model *'))) {
            headerRowIdx = i;
            break;
          }
        }
        if (headerRowIdx === -1) throw new Error('Could not find header row. Make sure you are using the SIP template.');

        const headers = raw[headerRowIdx].map(h => String(h).toLowerCase()
          .replace(/\s*\*/g,'').replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,''));

        // map header labels back to column keys
        const labelToKey = {
          'model_name': 'model', 'brand': 'brand', 'launch_date': 'launch_date',
          'launch_price': 'launch_price_inr', 'launch_price_inr': 'launch_price_inr',
          'price_segment': 'price_segment', 'amazon_yes_no': 'amazon_available',
          'flipkart_yes_no': 'flipkart_available', 'amazon': 'amazon_available',
          'flipkart': 'flipkart_available', 'processor': 'processor',
          'ram_comma_sep': 'ram_variants', 'ram_variants': 'ram_variants',
          'storage_comma_sep': 'storage_variants', 'storage_variants': 'storage_variants',
          'display': 'display', 'battery_mah': 'battery_mah', 'fast_charging_w': 'fast_charging_w',
          'rear_camera': 'rear_camera', 'front_camera': 'front_camera',
          'os': 'os', 'connectivity': 'connectivity', 'weight_g': 'weight_g',
          'source': 'source', 'ecom_rating': 'ecom_rating', 'rating_1_5': 'ecom_rating',
          'no_of_reviews': 'num_reviews', 'num_reviews': 'num_reviews',
          'noted_date': 'noted_date', 'date_yyyy_mm_dd': 'noted_date',
        };

        const colMap = headers.map(h => labelToKey[h] || h);
        const rows = [];

        for (let i = headerRowIdx + 1; i < raw.length; i++) {
          const row = raw[i];
          if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

          const obj = {};
          colMap.forEach((key, ci) => {
            if (!key) return;
            let val = row[ci];
            // handle Excel date objects
            if (val instanceof Date) {
              val = val.toISOString().slice(0, 10);
            } else {
              val = val === null || val === undefined ? '' : String(val).trim();
            }
            obj[key] = val;
          });

          // skip example/instruction rows
          if (!obj.model || obj.model.toLowerCase().includes('example') || obj.model.startsWith('⬇')) continue;
          rows.push(obj);
        }

        resolve(rows);
      } catch(e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Template download helpers (redirect to static files if hosted, else alert) ──
function downloadModelTemplate() {
  alert('Download "SIP_Model_Upload_Template.xlsx" from the files shared by the platform admin, or ask them to place it in /public/templates/.');
}
function downloadRatingsTemplate() {
  alert('Download "SIP_Ecom_Ratings_Template.xlsx" from the files shared by the platform admin.');
}
async function submitAddModel() {
  const statusEl = document.getElementById('addModelStatus');

  const brandSelect = document.getElementById('am_brand').value;
  const brand = brandSelect === '_other'
    ? document.getElementById('am_brand_other').value.trim()
    : brandSelect;

  const model       = document.getElementById('am_model').value.trim();
  const launch_date = document.getElementById('am_launch_date').value;
  const price       = document.getElementById('am_price').value;

  if (!model || !brand || !launch_date || !price) {
    statusEl.innerHTML = `<div class="notice danger">Please fill in Model Name, Brand, Launch Date, and Price.</div>`;
    return;
  }

  // parse RAM/Storage variants
  const ramRaw     = document.getElementById('am_ram').value.trim();
  const storageRaw = document.getElementById('am_storage').value.trim();
  const ram_variants     = ramRaw     ? ramRaw.split(',').map(s => s.trim()).filter(Boolean)     : [];
  const storage_variants = storageRaw ? storageRaw.split(',').map(s => s.trim()).filter(Boolean) : [];

  const payload = {
    model,
    brand,
    launch_date,
    launch_price_inr:   price,
    amazon_available:   document.getElementById('am_amazon').value,
    flipkart_available: document.getElementById('am_flipkart').value,
    price_segment:      document.getElementById('am_segment').value || '',
    processor:          document.getElementById('am_processor').value.trim(),
    ram_variants,
    storage_variants,
    display:            document.getElementById('am_display').value.trim(),
    battery_mah:        document.getElementById('am_battery').value,
    fast_charging_w:    document.getElementById('am_charging').value,
    rear_camera:        document.getElementById('am_rear_cam').value.trim(),
    front_camera:       document.getElementById('am_front_cam').value.trim(),
    os:                 document.getElementById('am_os').value.trim(),
    connectivity:       document.getElementById('am_connectivity').value.trim(),
    weight_g:           document.getElementById('am_weight').value,
  };

  statusEl.innerHTML = `<div class="notice"><span class="spinner"></span> Adding model...</div>`;

  try {
    const result = await apiPost('/api/add-model', payload);
    statusEl.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos);">✓ ${escapeHtml(result.message)}</div>`;

    // refresh STATE so new model appears everywhere
    const fresh = await apiGet('/api/data');
    STATE.phones = fresh.phones;
    STATE.specs  = fresh.specs;
    renderTopbar();
    clearAddModelForm();

    // re-render to update model dropdown in price section
    renderAdminView();
  } catch (e) {
    statusEl.innerHTML = `<div class="notice danger">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function clearAddModelForm() {
  ['am_model','am_brand_other','am_processor','am_ram','am_storage',
   'am_display','am_battery','am_charging','am_rear_cam','am_front_cam',
   'am_os','am_connectivity','am_weight','am_price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['am_brand','am_segment','am_amazon','am_flipkart'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  document.getElementById('am_brand_other_wrap').style.display = 'none';
  const s = document.getElementById('addModelStatus');
  if (s) s.innerHTML = '';
}

// ── Price Update submit ──
async function submitPriceUpdate() {
  const statusEl  = document.getElementById('priceUpdateStatus');
  const model_id  = document.getElementById('pu_model').value;
  const new_price = document.getElementById('pu_price').value;
  const source    = document.getElementById('pu_source').value;

  if (!model_id || !new_price) {
    statusEl.innerHTML = `<div class="notice danger">Select a model and enter the new price.</div>`;
    return;
  }

  statusEl.innerHTML = `<div class="notice"><span class="spinner"></span> Updating price...</div>`;

  try {
    const result = await apiPost('/api/update-price', { model_id: parseInt(model_id), new_price: parseFloat(new_price), source });
    statusEl.innerHTML = `<div class="notice" style="border-color:var(--pos); color:var(--pos);">✓ ${escapeHtml(result.message)}</div>`;

    // refresh phones
    const fresh = await apiGet('/api/data');
    STATE.phones = fresh.phones;
    renderTopbar();
  } catch (e) {
    statusEl.innerHTML = `<div class="notice danger">Failed: ${escapeHtml(e.message)}</div>`;
  }
}
