// api/prices.js
// Merged: update-price + bulk-update-ratings + ecom-scrape
// POST /api/prices?action=update     — single price update
// POST /api/prices?action=ratings    — bulk ratings from Excel
// GET  /api/prices?action=scrape     — auto-fetch prices from Amazon/Flipkart (batch of 5)
// GET  /api/prices?action=scrape&force=true — re-fetch even if already done today

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

// ---- E-com price scraping helpers ----------------------------------------

const SCRAPE_BATCH_SIZE = 5; // models per run — keeps Vercel under 60s timeout

function extractPriceFromHtml(html, source) {
  // Try JSON-LD first (most reliable across both platforms)
  const jsonLdMatches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
    try {
      const data = JSON.parse(inner);
      const objs = Array.isArray(data) ? data : [data];
      for (const obj of objs) {
        if (obj['@type'] === 'Product' || obj['@type'] === 'SoftwareApplication') {
          const offers = obj.offers || obj.Offers;
          if (offers) {
            const price = (Array.isArray(offers) ? offers[0] : offers).price;
            if (price && !isNaN(parseFloat(price))) return parseFloat(price);
          }
        }
      }
    } catch (_) { /* JSON parse failed — try next */ }
  }

  if (source === 'amazon') {
    let m = html.match(/data-asin-price="([0-9,]+(?:\.[0-9]+)?)"/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = html.match(/"priceAmount"\s*:\s*"?([0-9,]+(?:\.[0-9]+)?)"?/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = html.match(/<span[^>]+id="priceblock_ourprice"[^>]*>[\s\S]*?₹\s*([0-9,]+)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    const regexes = [
      /"buyingPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/,
      /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"/,
      /class="a-price-whole">([0-9,]+)</,
    ];
    for (const re of regexes) {
      const match = html.match(re);
      if (match) { const p = parseFloat(match[1].replace(/,/g, '')); if (p > 1000 && p < 200000) return p; }
    }
  }

  if (source === 'flipkart') {
    let m = html.match(/"finalPrice"\s*:\s*([0-9]+)/);
    if (m) return parseFloat(m[1]);
    m = html.match(/"price"\s*:\s*([0-9]+)/);
    if (m) { const p = parseFloat(m[1]); if (p > 1000 && p < 200000) return p; }
    m = html.match(/class="Nx9bqj[^"]*">₹([0-9,]+)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));
    m = html.match(/₹\s*([0-9,]{4,8})/);
    if (m) { const p = parseFloat(m[1].replace(/,/g, '')); if (p > 1000 && p < 200000) return p; }
  }

  return null;
}

async function fetchPriceFromUrl(url, source) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Referer': source === 'amazon' ? 'https://www.amazon.in/' : 'https://www.flipkart.com/',
  };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeoutId);
    if (!resp.ok) return { price: null, error: `HTTP ${resp.status}` };
    const html = await resp.text();
    const price = extractPriceFromHtml(html, source);
    return { price, error: price ? null : 'Price not found in page' };
  } catch (e) {
    clearTimeout(timeoutId);
    return { price: null, error: e.name === 'AbortError' ? 'Timeout (15s)' : e.message };
  }
}

// --------------------------------------------------------------------------

module.exports = async (req, res) => {
  // scrape action supports GET (cron) and POST (manual); everything else is POST-only
  const action = req.query.action || 'update';
  if (action === 'scrape') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  } else {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (action === 'update') {
      const { model_id, new_price, source } = req.body || {};
      if (!model_id || !new_price) return res.status(400).json({ error: 'model_id and new_price required.' });
      const { data: model } = await supabase.from('models').select('model').eq('model_id', model_id).single();
      await supabase.from('models').update({ current_price_inr: new_price, price_last_updated: today }).eq('model_id', model_id);
      await supabase.from('price_history').insert({ model_id, price: new_price, source: source || 'manual', noted_date: today });
      return res.status(200).json({ success: true, message: `Price updated for "${model?.model}": ₹${new_price}` });
    }

    if (action === 'ratings') {
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows array required.' });
      const { data: models } = await supabase.from('models').select('model_id, model');
      const modelMap = {};
      (models || []).forEach(m => { modelMap[m.model.toLowerCase().trim()] = m.model_id; });
      const results = [], errors = [];
      for (const row of rows) {
        const modelName = String(row.model || '').trim();
        const source    = String(row.source || '').trim();
        const rating    = parseFloat(row.ecom_rating);
        if (!modelName || !source || isNaN(rating)) { errors.push(`Skipped: missing fields for "${modelName}"`); continue; }
        const model_id = modelMap[modelName.toLowerCase()];
        if (!model_id) { errors.push(`Skipped: model not found — "${modelName}"`); continue; }
        const srcLow = source.toLowerCase();
        const ratingField = srcLow.includes('amazon') ? 'amazon_rating' : srcLow.includes('flipkart') ? 'flipkart_rating' : null;
        const countField  = srcLow.includes('amazon') ? 'amazon_reviews' : srcLow.includes('flipkart') ? 'flipkart_reviews' : null;
        if (!ratingField) { errors.push(`Skipped: unknown source "${source}"`); continue; }
        const upd = { [ratingField]: rating, price_last_updated: today };
        if (row.num_reviews && countField) upd[countField] = parseInt(row.num_reviews);
        const { error } = await supabase.from('models').update(upd).eq('model_id', model_id);
        if (error) { errors.push(`Error updating "${modelName}": ${error.message}`); continue; }
        results.push({ model_id, model: modelName, source, rating });
      }
      return res.status(200).json({ success: true, updated: results.length, errors, message: `${results.length} rating(s) updated.` });
    }

    if (action === 'bulk-variants') {
      // POST /api/prices?action=bulk-variants
      // Body: { rows: [{model, variants: [{ram, rom, launch_price, current_price}]}] }
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows required.' });

      const { data: models } = await supabase.from('models').select('model_id, model, launch_price_inr');
      const modelMap = {};
      (models || []).forEach(m => { modelMap[m.model.toLowerCase().trim()] = m; });

      const results = [], errors = [];

      for (const row of rows) {
        const modelName = String(row.model || '').trim();
        const modelData = modelMap[modelName.toLowerCase()];
        if (!modelData) { errors.push(`Model not found: "${modelName}"`); continue; }

        const validVariants = (row.variants || []).filter(v => v.ram && v.rom && (v.launch_price || v.current_price));
        if (!validVariants.length) continue;

        // build variant_prices object
        const existing = {};
        const { data: curr } = await supabase.from('models').select('variant_prices, base_variant').eq('model_id', modelData.model_id).single();
        Object.assign(existing, curr?.variant_prices || {});

        validVariants.forEach(v => {
          const label = `${v.ram}/${v.rom}`;
          existing[label] = {
            launch: v.launch_price ? parseFloat(v.launch_price) : (existing[label]?.launch || null),
            current: v.current_price ? parseFloat(v.current_price) : (existing[label]?.current || null),
          };
        });

        // base = cheapest launch variant
        const sorted = Object.entries(existing).sort((a,b) => (a[1].launch||999999)-(b[1].launch||999999));
        const base_variant = curr?.base_variant || (sorted[0]?.[0] || null);
        const baseLaunch   = sorted[0]?.[1]?.launch;
        const baseCurrent  = sorted[0]?.[1]?.current;

        const updateData = { variant_prices: existing };
        if (!curr?.base_variant && base_variant) updateData.base_variant = base_variant;
        if (baseLaunch)  updateData.launch_price_inr  = baseLaunch;
        if (baseCurrent) updateData.current_price_inr = baseCurrent;

        await supabase.from('models').update(updateData).eq('model_id', modelData.model_id);

        // price history for current prices
        for (const [label, prices] of Object.entries(existing)) {
          if (prices.current) {
            await supabase.from('price_history').insert({
              model_id: modelData.model_id, price: prices.current,
              source: 'bulk_upload', noted_date: today,
            }).then(() => {}).catch(() => {});
          }
        }

        results.push({ model: modelName, variants: Object.keys(existing).length });
      }

      return res.status(200).json({
        success: true, updated: results.length, errors,
        message: `${results.length} model(s) updated with variant prices.${errors.length ? ` ${errors.length} skipped.` : ''}`,
      });
    }

    if (action === 'variant') {
      // POST /api/prices?action=variant
      // Body: { model_id, variant_label, launch_price, current_price }
      const { model_id, variant_label, launch_price, current_price } = req.body || {};
      if (!model_id || !variant_label) return res.status(400).json({ error: 'model_id and variant_label required.' });

      // get existing variant_prices
      const { data: model } = await supabase.from('models').select('model, variant_prices, base_variant').eq('model_id', model_id).single();
      const existing = model?.variant_prices || {};

      // add/update this variant
      existing[variant_label] = {
        launch: launch_price ? parseFloat(launch_price) : (existing[variant_label]?.launch || null),
        current: current_price ? parseFloat(current_price) : (existing[variant_label]?.current || null),
      };

      // update model — also set base_variant if it's the first/cheapest
      const variants = Object.entries(existing);
      const cheapest = variants.sort((a,b) => (a[1].launch||999999) - (b[1].launch||999999))[0];
      const base_variant = model?.base_variant || (cheapest ? cheapest[0] : null);
      // update launch_price_inr to match base variant if not set
      const basePrice = cheapest?.[1]?.launch;

      const updateData = { variant_prices: existing };
      if (!model?.base_variant && base_variant) updateData.base_variant = base_variant;
      if (basePrice) updateData.launch_price_inr = basePrice;

      await supabase.from('models').update(updateData).eq('model_id', model_id);

      return res.status(200).json({
        success: true,
        message: `Variant "${variant_label}" saved for "${model?.model}".`,
        variant_prices: existing,
      });
    }

    if (action === 'assets') {
      // POST /api/prices?action=assets
      // Body: { rows: [{model, official_website, kv1, kv2, kv3, youtube, x_twitter, instagram, facebook, notes}] }
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'rows array required.' });

      const { data: models } = await supabase.from('models').select('model_id, model');
      const modelMap = {};
      (models || []).forEach(m => { modelMap[m.model.toLowerCase().trim()] = m.model_id; });

      const results = [], errors = [];

      for (const row of rows) {
        const modelName = String(row.model || '').trim();
        const model_id = modelMap[modelName.toLowerCase()];
        if (!model_id) { errors.push(`Model not found: "${modelName}"`); continue; }

        const assetTypes = [
          { type: 'website',   platform: 'brand_site',  url: row.official_website, campaign_name: 'Official Website' },
          { type: 'kv',        platform: 'print_digital', url: row.kv1, campaign_name: 'KV 1' },
          { type: 'kv',        platform: 'print_digital', url: row.kv2, campaign_name: 'KV 2' },
          { type: 'kv',        platform: 'print_digital', url: row.kv3, campaign_name: 'KV 3' },
          { type: 'video',     platform: 'YouTube',       url: row.youtube, campaign_name: 'Official YouTube' },
          { type: 'post',      platform: 'X',             url: row.x_twitter, campaign_name: 'X / Twitter' },
          { type: 'post',      platform: 'Instagram',     url: row.instagram, campaign_name: 'Instagram' },
          { type: 'post',      platform: 'Facebook',      url: row.facebook, campaign_name: 'Facebook' },
        ].filter(a => a.url && String(a.url).trim().startsWith('http'));

        if (!assetTypes.length) { errors.push(`No valid URLs for "\${modelName}"`); continue; }

        const toInsert = assetTypes.map(a => ({
          model_id,
          type: a.type,
          platform: a.platform,
          campaign_name: a.campaign_name,
          url: String(a.url).trim(),
          notes: row.notes || null,
          tags: [],
          asset_date: null,
        }));

        // insert all assets in one batch — delete existing first to avoid duplicates
        await supabase.from('marketing_assets').delete().eq('model_id', model_id);
        if (toInsert.length > 0) {
          const { error: insertErr } = await supabase.from('marketing_assets').insert(toInsert);
          if (insertErr) { errors.push(`Insert failed for "${modelName}": ${insertErr.message}`); continue; }
        }

        results.push({ model: modelName, assets_added: toInsert.length });

        // Auto-analyze first KV image with Claude vision (optional — silent fail)
        try {
          const kvAsset = toInsert.find(a => a.type === 'kv' && a.url?.match(/\.(jpg|jpeg|png|webp)/i));
          if (kvAsset && process.env.ANTHROPIC_API_KEY) {
            const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({
                model: 'claude-sonnet-4-6', max_tokens: 400,
                messages: [{ role: 'user', content: [
                  { type: 'image', source: { type: 'url', url: kvAsset.url } },
                  { type: 'text', text: 'Analyse this smartphone marketing creative. Return ONLY a JSON object: {"usp":"main benefit shown","positioning":"one-line strategy e.g. Battery Beast","hero_message":"tagline visible","target_audience":"who this targets"}. No explanation, only JSON.' }
                ]}]
              }),
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const text = (aiData.content || []).find(b => b.type === 'text')?.text || '';
              try {
                const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
                await supabase.from('models').update({
                  kv_usp: parsed.usp || null,
                  kv_positioning: parsed.positioning || null,
                  kv_hero_message: parsed.hero_message || null,
                  kv_target_audience: parsed.target_audience || null,
                  kv_analyzed_at: new Date().toISOString().slice(0, 10),
                }).eq('model_id', model_id);
              } catch(_) { /* JSON parse failed — skip */ }
            }
          }
        } catch(_) { /* KV analysis failed silently — upload still succeeds */ }
      }

      const totalAssets = results.reduce((s, r) => s + r.assets_added, 0);
      return res.status(200).json({
        success: true,
        processed: results.length,
        errors,
        message: `${totalAssets} assets added across ${results.length} models.`,
      });
    }

    // ---- Auto-scrape prices from Amazon / Flipkart -------------------------
    // GET /api/prices?action=scrape           — process oldest-updated batch
    // GET /api/prices?action=scrape&force=true — re-fetch even if done today
    if (action === 'scrape') {
      const force = req.query.force === 'true' || req.body?.force === true;
      const scrapeLog = [];

      // Fetch models that have at least one e-com URL, oldest-updated first
      const { data: models, error: fetchErr } = await supabase
        .from('models')
        .select('model_id, model, amazon_url, flipkart_url, current_price_inr, price_last_updated')
        .or('amazon_url.not.is.null,flipkart_url.not.is.null')
        .order('price_last_updated', { ascending: true, nullsFirst: true });

      if (fetchErr) return res.status(500).json({ error: fetchErr.message });
      if (!models?.length) {
        return res.status(200).json({ success: true, message: 'No models with e-com URLs found.', log: [] });
      }

      // Skip models already updated today unless force=true
      const pending = force
        ? models
        : models.filter(m => !m.price_last_updated || m.price_last_updated < today);

      if (!pending.length) {
        return res.status(200).json({
          success: true,
          message: `All ${models.length} model(s) already updated today. Use force=true to re-scrape.`,
          log: [], pending: 0, total: models.length,
        });
      }

      const batch = pending.slice(0, SCRAPE_BATCH_SIZE);
      scrapeLog.push(`Processing ${batch.length} of ${pending.length} pending models (${models.length} total have URLs)`);

      const results = { updated: 0, failed: 0 };

      for (const model of batch) {
        const mLog = [`[${model.model}]`];
        let newPrice = null;
        let priceSource = null;

        // Try Amazon first, then Flipkart
        if (model.amazon_url) {
          const { price, error } = await fetchPriceFromUrl(model.amazon_url, 'amazon');
          if (price) { newPrice = price; priceSource = 'amazon'; mLog.push(`Amazon: ₹${price.toLocaleString('en-IN')}`); }
          else mLog.push(`Amazon: failed (${error})`);
        }
        if (!newPrice && model.flipkart_url) {
          const { price, error } = await fetchPriceFromUrl(model.flipkart_url, 'flipkart');
          if (price) { newPrice = price; priceSource = 'flipkart'; mLog.push(`Flipkart: ₹${price.toLocaleString('en-IN')}`); }
          else mLog.push(`Flipkart: failed (${error})`);
        }

        if (!newPrice) {
          mLog.push('→ No price extracted — skipped');
          scrapeLog.push(mLog.join(' '));
          results.failed++;
          // Mark as attempted today so we don't retry every few minutes
          await supabase.from('models').update({ price_last_updated: today }).eq('model_id', model.model_id);
          continue;
        }

        const changed = model.current_price_inr && Math.abs(model.current_price_inr - newPrice) > 1;
        if (changed) mLog.push(`→ Changed: ₹${Math.round(model.current_price_inr).toLocaleString('en-IN')} → ₹${Math.round(newPrice).toLocaleString('en-IN')}`);
        else mLog.push(`→ ₹${Math.round(newPrice).toLocaleString('en-IN')} (no change)`);

        await supabase.from('models')
          .update({ current_price_inr: newPrice, price_last_updated: today })
          .eq('model_id', model.model_id);

        // Record price history only on change (or first price)
        if (changed || !model.current_price_inr) {
          await supabase.from('price_history').insert({
            model_id: model.model_id, price: newPrice, source: priceSource, noted_date: today,
          });
        }

        scrapeLog.push(mLog.join(' '));
        results.updated++;
      }

      const stillPending = pending.length - batch.length;
      return res.status(200).json({
        success: true,
        message: `Batch done: ${results.updated} updated, ${results.failed} failed.${stillPending > 0 ? ` ${stillPending} more pending — run again.` : ' All done for today.'}`,
        log: scrapeLog,
        updated: results.updated,
        failed: results.failed,
        pending: stillPending,
        total: models.length,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('prices.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};
