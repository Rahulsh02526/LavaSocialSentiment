// api/scan-models.js
// Scan GSMArena India for newly launched phones and queue them for admin review.
//
// GET  /api/scan-models?action=status   — pending_models list (viewer)
// POST /api/scan-models?action=scan     — trigger scan (admin)
// POST /api/scan-models?action=approve  — approve + add model (admin) body: { id }
// POST /api/scan-models?action=reject   — reject pending model (admin) body: { id }
// POST /api/scan-models?action=bulk-approve — approve multiple at once body: { ids:[] }
// GET  /api/cron-scan-models (cron call) — same as action=scan

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin, requireViewer } = require('../lib/auth');
const https = require('https');

// ─── Helpers ────────────────────────────────────────────────────────────────

// Fetch a URL with redirect following (up to 5 hops) and realistic browser headers.
// GSMArena returns 302 → www.gsmarena.com when hit without a Host header or with
// a bare IP; following the redirect resolves it cleanly.
function fetchUrl(url, extraHeaders = {}, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) return reject(new Error('Too many redirects'));
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        // Realistic desktop Chrome UA — mobile UA sometimes triggers Cloudflare challenges
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,en-IN;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        ...extraHeaders,
      },
      timeout: 20000,
    };
    const req = https.get(opts, (res) => {
      // Follow 301/302/303/307/308 redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${parsed.hostname}${res.headers.location}`;
        // Drain response before following
        res.resume();
        return resolve(fetchUrl(nextUrl, extraHeaders, _redirects + 1));
      }
      // Handle gzip/br compressed responses
      let stream = res;
      const encoding = res.headers['content-encoding'];
      if (encoding === 'gzip' || encoding === 'deflate') {
        const zlib = require('zlib');
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'br') {
        const zlib = require('zlib');
        stream = res.pipe(zlib.createBrotliDecompress());
      }
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { body += chunk; });
      stream.on('end', () => resolve({ status: res.statusCode, body }));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// Known brands we track (lowercase)
const TRACKED_BRANDS = [
  'lava', 'samsung', 'realme', 'redmi', 'xiaomi', 'poco', 'iqoo', 'vivo',
  'oneplus', 'motorola', 'nokia', 'tecno', 'itel', 'infinix', 'oppo', 'hmd',
  'ai+', 'nothing', 'micromax',
];

// Extract brand from model name
function detectBrand(name) {
  const lower = name.toLowerCase();
  for (const b of TRACKED_BRANDS) {
    if (lower.startsWith(b + ' ') || lower.startsWith(b)) return b;
  }
  return null;
}

// Scrape GSMArena India launches page — returns array of { name, url, thumb, announced }
async function scrapeGSMArenaIndia(log) {
  // GSMArena "newly announced" sorted by announced date, filtered to India
  const urls = [
    'https://www.gsmarena.com/search.php3?chk5G=selected&sQuickSearch=&fDisplayInchesMin=5.5&fDisplayInchesMax=7.5&fRAMMin=0&fStorageMin=0&chkIndia=selected&sortBy=0&sOSes=2&sMakers=',
    // Also try brand-specific pages for tracked brands (but limit to avoid 60s timeout)
    'https://www.gsmarena.com/search.php3?chk5G=selected&chkIndia=selected&sortBy=0&fYearMin=2026&sOSes=2',
  ];

  const found = new Map(); // url → phone obj (deduplicate)

  for (const pageUrl of urls.slice(0, 1)) { // Only first URL to stay within timeout
    try {
      const { status, body } = await fetchUrl(pageUrl);
      log.push(`GSMArena fetch: HTTP ${status} (${body.length} bytes)`);
      if (status !== 200 || body.length < 1000) continue;

      // Parse phone entries from search results
      // Pattern: <li> blocks with class "makers" or similar
      // GSMArena search result format:
      // <li>...<a href="phone-name-XXXX.php"><img src="..."/><span>Name</span></a></li>
      const liMatches = body.matchAll(/<li[^>]*>[\s\S]*?<a href="([^"]+\.php)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g);

      for (const m of liMatches) {
        const path = m[1];
        const thumb = m[2];
        const rawName = m[3].replace(/<[^>]+>/g, '').trim();
        if (!rawName || rawName.length < 4) continue;

        const fullUrl = 'https://www.gsmarena.com/' + path;
        if (!found.has(fullUrl)) {
          found.set(fullUrl, { name: rawName, url: fullUrl, thumb, announced: null });
        }
      }

      // Fallback: simpler pattern for phone names
      if (found.size === 0) {
        const spans = body.matchAll(/href="([a-z0-9_-]+-\d+\.php)"[^>]*>[\s\S]*?<span[^>]*>([\w\s]+?(?:5G|4G|Pro|Plus|Ultra|Lite|Max)?[\w\s]*?)<\/span>/g);
        for (const s of spans) {
          const path = s[1];
          const name = s[2].trim();
          if (name.length < 4 || /^\d/.test(name)) continue;
          const fullUrl = 'https://www.gsmarena.com/' + path;
          if (!found.has(fullUrl)) {
            found.set(fullUrl, { name, url: fullUrl, thumb: null, announced: null });
          }
        }
      }

      log.push(`Parsed ${found.size} phones from GSMArena`);
    } catch (e) {
      log.push(`GSMArena fetch error: ${e.message}`);
    }
  }

  return Array.from(found.values());
}

// Auto-detect notable / unusual USPs from raw GSMArena HTML
// Returns array of human-readable labels (empty if nothing notable found)
function detectNotableUSPs(body, phoneName = '') {
  const text = body.toLowerCase();
  const usps = [];

  // Helper: check if any pattern matches
  const has = (...patterns) => patterns.some(p =>
    typeof p === 'string' ? text.includes(p) : p.test(text)
  );

  // ── Display / Form Factor ────────────────────────────────────────────────
  if (has('dual screen', 'dual display', 'second screen', 'cover screen', 'outer display'))
    usps.push('Dual Screen');
  if (has('curved display', 'curved screen', 'curved edge', '3d curved'))
    usps.push('Curved Display');
  if (has('foldable', 'flip phone', 'clamshell', 'book-style'))
    usps.push('Foldable');
  if (has('rollable', 'extendable screen', 'expandable display'))
    usps.push('Rollable Display');
  if (has('under-display camera', 'under display camera', 'under-screen camera', 'udc'))
    usps.push('Under-Display Camera');
  if (has('under-display fingerprint', 'under-screen fingerprint', 'in-display fingerprint', 'in display fingerprint'))
    usps.push('Under-Display Fingerprint');
  if (has('aod', 'always-on display', 'always on display'))
    usps.push('Always-On Display');

  // ── Glass / Build ────────────────────────────────────────────────────────
  if (has('gorilla glass victus 2', 'victus2', 'victus 2'))
    usps.push('Gorilla Glass Victus 2');
  else if (has('gorilla glass victus+', 'victus+'))
    usps.push('Gorilla Glass Victus+');
  else if (has('gorilla glass victus'))
    usps.push('Gorilla Glass Victus');
  else if (has('gorilla glass 7i', 'gorilla 7i'))
    usps.push('Gorilla Glass 7i');
  else if (has('gorilla glass 7'))
    usps.push('Gorilla Glass 7');
  else if (has('gorilla glass 5'))
    usps.push('Gorilla Glass 5');
  if (has('titanium frame', 'titanium build', 'titanium alloy'))
    usps.push('Titanium Frame');
  if (has('ceramic back', 'ceramic body', 'ceramic build'))
    usps.push('Ceramic Build');
  if (has('vegan leather', 'eco leather'))
    usps.push('Vegan Leather Back');
  if (has('matte glass', 'frosted glass'))
    usps.push('Frosted Glass');

  // ── Water / Dust Resistance ──────────────────────────────────────────────
  if (has('ip68'))
    usps.push('IP68 Water Resistant');
  else if (has('ip67'))
    usps.push('IP67 Water Resistant');
  else if (has('ip65'))
    usps.push('IP65 Splash Resistant');
  else if (has(/ip5[0-9]/))
    usps.push('Water Resistant');
  if (has('mil-std-810', 'mil spec', 'military grade'))
    usps.push('MIL-STD-810 Rugged');

  // ── Camera ───────────────────────────────────────────────────────────────
  if (has('periscope', 'periscope telephoto', 'periscope zoom'))
    usps.push('Periscope Telephoto Camera');
  if (has('200mp', '200 mp', '200-megapixel'))
    usps.push('200MP Camera');
  if (has('1-inch sensor', '1 inch sensor', 'one-inch sensor', '1" sensor'))
    usps.push('1-Inch Camera Sensor');
  if (has('optical zoom 10x', '10x optical', '10x zoom'))
    usps.push('10x Optical Zoom');
  if (has('variable aperture'))
    usps.push('Variable Aperture');
  if (has('night mode', 'astrophotography'))
    usps.push('Advanced Night Mode');

  // ── Connectivity ─────────────────────────────────────────────────────────
  if (has('satellite connectivity', 'satellite communication', 'satellite sos', 'emergency sos via satellite'))
    usps.push('Satellite Connectivity');
  if (has('wi-fi 7', 'wifi 7', '802.11be'))
    usps.push('Wi-Fi 7');
  if (has('wi-fi 6e', 'wifi 6e', '6ghz wi-fi'))
    usps.push('Wi-Fi 6E');
  if (has('uwb', 'ultra-wideband', 'ultra wideband'))
    usps.push('UWB');

  // ── Stylus / Input ───────────────────────────────────────────────────────
  if (has('stylus', 's pen', 'moto pen', 'smart pen') && !has('bluetooth stylus (optional)'))
    usps.push('Stylus Support');

  // ── Charging / Battery ───────────────────────────────────────────────────
  if (has('reverse wireless charging', 'wireless power share', 'powershare'))
    usps.push('Reverse Wireless Charging');
  if (has('wireless charging') && !has('no wireless charging'))
    usps.push('Wireless Charging');
  if (has('200w charging', '200w fast charge'))
    usps.push('200W Ultra-Fast Charging');
  else if (has('120w charging', '120w fast charge'))
    usps.push('120W Super-Fast Charging');
  else if (has('100w charging', '100w fast charge'))
    usps.push('100W Fast Charging');
  if (has('silicon-carbon battery', 'si-c battery', 'silicon carbon'))
    usps.push('Silicon-Carbon Battery');

  // ── Cooling / Performance ────────────────────────────────────────────────
  if (has('vapor chamber', 'vapour chamber', 'vapor cooling'))
    usps.push('Vapor Chamber Cooling');

  // ── Other Notable ────────────────────────────────────────────────────────
  if (has('in-box earphones', 'bundled earphones', 'earphones in-box'))
    usps.push('Earphones In-Box');
  if (has('dual sim', 'dual-sim') && has('esim', 'e-sim'))
    usps.push('Dual SIM + eSIM');
  else if (has('esim', 'e-sim'))
    usps.push('eSIM Support');
  if (has('desktop mode', 'dex mode', 'pc mode', 'desktop experience'))
    usps.push('Desktop Mode');
  if (has('gaming mode', 'gaming triggers', 'shoulder triggers', 'gaming shoulder'))
    usps.push('Gaming Triggers');
  if (has('ir blaster', 'infrared blaster'))
    usps.push('IR Blaster');

  // Also flag phone name hints (e.g. "Rugged" / "Flip" in the name)
  const nameL = phoneName.toLowerCase();
  if (/\brugged\b/.test(nameL) && !usps.some(u => u.includes('Rugged')))
    usps.push('Rugged Build');
  if (/\bflip\b/.test(nameL) && !usps.some(u => u.includes('Foldable')))
    usps.push('Foldable');

  // De-duplicate
  return [...new Set(usps)];
}

// Quick spec extract from GSMArena phone page
async function fetchPhoneSpecs(phone, log) {
  try {
    const { status, body } = await fetchUrl(phone.url);
    if (status !== 200 || body.length < 5000) return phone;

    // Launch date
    const dateM = body.match(/Announced\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
    if (dateM) phone.announced = dateM[1].replace(/<[^>]+>/g, '').trim().split('.')[0].trim();

    // Launch price (India)
    const priceM = body.match(/(?:India|₹|INR)[^₹\d]*₹\s*([\d,]+)/i)
      || body.match(/(?:price|starting at)[^₹\d]*₹\s*([\d,]+)/i);
    if (priceM) phone.price = parseInt(priceM[1].replace(/,/g, ''));

    // Check if 5G
    phone.is5G = /\b5G\b/.test(body) || phone.name.includes('5G');

    // Processor
    const cpuM = body.match(/Chipset\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
    if (cpuM) phone.processor = cpuM[1].replace(/<[^>]+>/g, '').trim().slice(0, 80);

    // RAM
    const ramM = body.match(/Internal\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
    if (ramM) {
      const ramText = ramM[1].replace(/<[^>]+>/g, '');
      const rams = [...new Set((ramText.match(/\d+\s*GB\s*RAM/gi) || []).map(r => r.replace(/\s+/g, '')))];
      if (rams.length) phone.ram_variants = rams.join(', ');
    }

    // Battery
    const batM = body.match(/Battery\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
    if (batM) {
      const batText = batM[1].replace(/<[^>]+>/g, '');
      const batNum = batText.match(/(\d{4,5})\s*mAh/i);
      if (batNum) phone.battery_mah = parseInt(batNum[1]);
    }

    // OS
    const osM = body.match(/OS\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
    if (osM) phone.os = osM[1].replace(/<[^>]+>/g, '').trim().slice(0, 40);

    // Auto-detect notable USPs from page content
    phone.suggested_usps = detectNotableUSPs(body, phone.name);

    return phone;
  } catch (e) {
    log.push(`Spec fetch failed for ${phone.name}: ${e.message}`);
    return phone;
  }
}

function deriveSegment(price) {
  if (!price) return null;
  if (price < 10000) return 'budget';
  if (price < 15000) return 'entry_mid';
  if (price < 20000) return 'mid';
  if (price < 25000) return 'upper_mid';
  if (price < 35000) return 'premium_mid';
  return 'premium';
}

// ─── Main scan logic ─────────────────────────────────────────────────────────

async function runScan(supabase, log, options = {}) {
  const { maxNewSpecs = 5 } = options; // limit spec-fetch calls to stay under 60s

  // 1. Get existing model names from DB (to diff)
  const { data: existing, error: exErr } = await supabase.from('models').select('model');
  if (exErr) throw new Error('DB read failed: ' + exErr.message);
  const existingNames = new Set((existing || []).map(m => m.model.toLowerCase().trim()));

  // 2. Get already-pending names (don't re-add)
  const { data: pending } = await supabase.from('pending_models').select('model_name, status');
  const pendingNames = new Set((pending || [])
    .filter(p => p.status === 'pending')
    .map(p => p.model_name.toLowerCase().trim()));

  log.push(`Existing models: ${existingNames.size}, Pending: ${pendingNames.size}`);

  // 3. Scrape GSMArena
  const scraped = await scrapeGSMArenaIndia(log);
  log.push(`Scraped: ${scraped.length} phones total`);

  // 4. Filter to tracked brands, ₹5K–₹50K, 5G, not already in DB or pending
  const candidates = scraped.filter(p => {
    const brand = detectBrand(p.name);
    if (!brand) return false;
    const lname = p.name.toLowerCase().trim();
    if (existingNames.has(lname) || pendingNames.has(lname)) return false;
    return true;
  });

  log.push(`New candidates (tracked brands, not in DB): ${candidates.length}`);

  // 5. Fetch specs for top N candidates
  const toEnrich = candidates.slice(0, maxNewSpecs);
  const enriched = [];
  for (const c of toEnrich) {
    const enrichedPhone = await fetchPhoneSpecs(c, log);
    // Filter: price ₹5K–₹50K if we got a price
    if (enrichedPhone.price && (enrichedPhone.price < 5000 || enrichedPhone.price > 50000)) {
      log.push(`Skipped ${c.name}: price ₹${enrichedPhone.price} out of range`);
      continue;
    }
    enriched.push(enrichedPhone);
  }

  // 6. Insert into pending_models
  const inserted = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const p of enriched) {
    const brand = detectBrand(p.name) || 'unknown';
    const row = {
      model_name: p.name,
      brand,
      gsmarena_url: p.url,
      thumb_url: p.thumb || null,
      announced: p.announced || null,
      estimated_price: p.price || null,
      price_segment: deriveSegment(p.price),
      processor: p.processor || null,
      ram_variants: p.ram_variants || null,
      battery_mah: p.battery_mah || null,
      os: p.os || null,
      is_5g: p.is5G || p.name.includes('5G'),
      status: 'pending',
      scanned_at: today,
      notes: null,
      suggested_usps: (p.suggested_usps && p.suggested_usps.length) ? p.suggested_usps : null,
    };

    const { error: insErr } = await supabase.from('pending_models').upsert(row, {
      onConflict: 'model_name',
      ignoreDuplicates: false,
    });

    if (insErr) {
      log.push(`Insert failed for ${p.name}: ${insErr.message}`);
    } else {
      log.push(`✓ Queued: ${p.name}${p.price ? ' ₹' + p.price.toLocaleString() : ''}`);
      inserted.push(p.name);
    }
  }

  // Also queue non-enriched candidates (without specs) if any remain
  const remaining = candidates.slice(maxNewSpecs);
  for (const p of remaining) {
    const brand = detectBrand(p.name) || 'unknown';
    const { error: insErr } = await supabase.from('pending_models').upsert({
      model_name: p.name,
      brand,
      gsmarena_url: p.url,
      thumb_url: p.thumb || null,
      is_5g: p.name.includes('5G'),
      status: 'pending',
      scanned_at: today,
    }, { onConflict: 'model_name', ignoreDuplicates: true });

    if (!insErr) inserted.push(p.name + ' (no specs)');
  }

  return {
    total_scraped: scraped.length,
    new_candidates: candidates.length,
    queued: inserted.length,
    names: inserted,
  };
}

// ─── Approve: add model from pending_models to actual models table ────────────

async function approveModel(supabase, pendingId, approvedUsps) {
  // 1. Get pending model
  const { data, error } = await supabase.from('pending_models').select('*').eq('id', pendingId).single();
  if (error || !data) throw new Error('Pending model not found');

  const p = data;

  // 2. Get max model_id
  const { data: maxData } = await supabase.from('models').select('model_id').order('model_id', { ascending: false }).limit(1);
  const nextId = ((maxData?.[0]?.model_id) || 0) + 1;

  // 3. Derive launch date — use announced or today
  const launchDate = p.announced
    ? (() => {
        // Handle formats like "2026, January" or "January 2026" or "2026-01-15"
        const d = new Date(p.announced);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return new Date().toISOString().slice(0, 10);
      })()
    : new Date().toISOString().slice(0, 10);

  const price = p.estimated_price || 0;
  const deriveSegment = (pr) => {
    if (pr < 10000) return 'budget';
    if (pr < 15000) return 'entry_mid';
    if (pr < 20000) return 'mid';
    if (pr < 25000) return 'upper_mid';
    if (pr < 35000) return 'premium_mid';
    return 'premium';
  };

  function addMonths(dateStr, months) {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  // 4. Insert into models
  const { error: modelErr } = await supabase.from('models').insert({
    model_id: nextId,
    model: p.model_name,
    brand: p.brand,
    launch_date: launchDate,
    launch_price_inr: price || null,
    current_price_inr: price || null,
    amazon_available: 'No',
    flipkart_available: 'No',
    price_segment: p.price_segment || (price ? deriveSegment(price) : null),
    sentiment_frozen_at: addMonths(launchDate, 6),
    price_frozen_at: addMonths(launchDate, 12),
    rank_original: `#${nextId}`,
  });
  if (modelErr) throw new Error('Model insert failed: ' + modelErr.message);

  // 5. Insert specs if available
  // approvedUsps: passed by admin (their curated selection); fallback to suggested_usps from scan
  const finalUsps = Array.isArray(approvedUsps) && approvedUsps.length
    ? approvedUsps
    : (Array.isArray(p.suggested_usps) && p.suggested_usps.length ? p.suggested_usps : null);

  if (p.processor || p.battery_mah || p.ram_variants || p.os || finalUsps) {
    const parseArr = (v) => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
    await supabase.from('specs').insert({
      model_id: nextId,
      processor: p.processor || null,
      ram_variants: parseArr(p.ram_variants),
      battery_mah: p.battery_mah || null,
      os: p.os || null,
      key_usps: finalUsps || null,
      source_confidence: 'scan',
    });
  }

  // 6. Mark pending as approved
  await supabase.from('pending_models').update({ status: 'approved', approved_at: new Date().toISOString().slice(0, 10) }).eq('id', pendingId);

  return { model_id: nextId, model: p.model_name };
}

// ─── Main handler ────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const action = req.query.action || (req.method === 'GET' ? 'status' : 'scan');
  const supabase = getSupabaseClient();

  // Status — viewer can see pending list
  if (action === 'status') {
    if (!requireViewer(req, res)) return;
    const { data, error } = await supabase
      .from('pending_models')
      .select('*')
      .order('scanned_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ pending: data || [] });
  }

  // All other actions require admin
  if (!requireAdmin(req, res)) return;

  if (action === 'scan') {
    const log = [];
    try {
      const result = await runScan(supabase, log);
      return res.status(200).json({
        ok: true,
        message: result.queued > 0
          ? `Found ${result.new_candidates} new models, queued ${result.queued} for review`
          : `Scan complete — no new models found (${result.total_scraped} checked)`,
        ...result,
        log,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message, log });
    }
  }

  if (action === 'approve') {
    const { id, approved_usps } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      // approved_usps: optional string[] of USPs admin confirmed/curated before approving
      const result = await approveModel(supabase, id, approved_usps || null);
      return res.status(200).json({ ok: true, message: `✓ Added "${result.model}" as model #${result.model_id}`, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (action === 'bulk-approve') {
    const { ids } = req.body || {};
    if (!ids?.length) return res.status(400).json({ error: 'ids[] required' });
    const results = [];
    const errors = [];
    for (const id of ids) {
      try {
        const r = await approveModel(supabase, id);
        results.push(r);
      } catch (e) {
        errors.push(`#${id}: ${e.message}`);
      }
    }
    return res.status(200).json({
      ok: true,
      message: `Added ${results.length} model(s)${errors.length ? `, ${errors.length} failed` : ''}`,
      added: results,
      errors,
    });
  }

  if (action === 'reject') {
    const { id, reason } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('pending_models')
      .update({ status: 'rejected', notes: reason || null })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, message: 'Rejected' });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
};
