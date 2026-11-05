// api/cron-ecom-scrape.js
// Manual trigger: GET /api/cron-ecom-scrape           — scrapes 1 batch (up to 5 models)
// Manual trigger: GET /api/cron-ecom-scrape?force=true — skips "already done today" check
// GitHub Actions cron: also hits this endpoint daily
//
// What it does:
//   1. Finds models where amazon_url or flipkart_url is set
//   2. Skips models already updated today (unless ?force=true)
//   3. Fetches the page, extracts price from JSON-LD or meta tags
//   4. Updates models.current_price_inr and price_history
//   5. Returns a log of what happened

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

const BATCH_SIZE = 5; // models per run (keeps Vercel under 60s timeout)

// ---- Price extraction helpers ----------------------------------------

function extractPriceFromHtml(html, source) {
  // Try JSON-LD first (most reliable)
  const jsonLdMatches = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const inner = block.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
    try {
      const data = JSON.parse(inner);
      const objs = Array.isArray(data) ? data : [data];
      for (const obj of objs) {
        // Product schema
        if (obj['@type'] === 'Product' || obj['@type'] === 'SoftwareApplication') {
          const offers = obj.offers || obj.Offers;
          if (offers) {
            const price = (Array.isArray(offers) ? offers[0] : offers).price;
            if (price && !isNaN(parseFloat(price))) return parseFloat(price);
          }
        }
      }
    } catch (_) { /* JSON parse failed — try next block */ }
  }

  if (source === 'amazon') {
    // Amazon: data-asin-price or priceblock_ourprice
    let m = html.match(/data-asin-price="([0-9,]+(?:\.[0-9]+)?)"/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));

    m = html.match(/"priceAmount"\s*:\s*"?([0-9,]+(?:\.[0-9]+)?)"?/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));

    m = html.match(/<span[^>]+id="priceblock_ourprice"[^>]*>[\s\S]*?₹\s*([0-9,]+)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));

    // Fallback: search for ₹ followed by numbers in common patterns
    const priceRegexes = [
      /"buyingPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/,
      /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"/,
      /class="a-price-whole">([0-9,]+)</,
    ];
    for (const re of priceRegexes) {
      const match = html.match(re);
      if (match) {
        const p = parseFloat(match[1].replace(/,/g, ''));
        if (p > 1000 && p < 200000) return p; // sanity check: ₹1k–₹2L range
      }
    }
  }

  if (source === 'flipkart') {
    // Flipkart: finalPrice in JSON or class="Nx9bqj CxhGGd"
    let m = html.match(/"finalPrice"\s*:\s*([0-9]+)/);
    if (m) return parseFloat(m[1]);

    m = html.match(/"price"\s*:\s*([0-9]+)/);
    if (m) {
      const p = parseFloat(m[1]);
      if (p > 1000 && p < 200000) return p;
    }

    m = html.match(/class="Nx9bqj[^"]*">₹([0-9,]+)/);
    if (m) return parseFloat(m[1].replace(/,/g, ''));

    m = html.match(/₹\s*([0-9,]{4,8})/);
    if (m) {
      const p = parseFloat(m[1].replace(/,/g, ''));
      if (p > 1000 && p < 200000) return p;
    }
  }

  return null;
}

async function fetchPrice(url, source) {
  // Headers that make us look like a real browser
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-IN,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
  if (source === 'amazon') {
    headers['Referer'] = 'https://www.amazon.in/';
  } else {
    headers['Referer'] = 'https://www.flipkart.com/';
  }

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

// ---- Main handler -------------------------------------------------------

module.exports = async (req, res) => {
  // Allow GET (cron) and POST (manual trigger from UI)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const force = req.query.force === 'true' || req.body?.force === true;
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);
  const log = [];

  try {
    // 1. Fetch all models that have at least one e-com URL
    const { data: models, error: fetchErr } = await supabase
      .from('models')
      .select('model_id, model, amazon_url, flipkart_url, current_price_inr, price_last_updated')
      .or('amazon_url.not.is.null,flipkart_url.not.is.null')
      .order('price_last_updated', { ascending: true, nullsFirst: true }); // oldest-updated first

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!models?.length) {
      return res.status(200).json({ success: true, message: 'No models with e-com URLs found.', log: [] });
    }

    // 2. Filter: skip models already updated today (unless force=true)
    const pending = force
      ? models
      : models.filter(m => !m.price_last_updated || m.price_last_updated < today);

    if (!pending.length) {
      return res.status(200).json({
        success: true,
        message: `All ${models.length} model(s) already updated today. Use force=true to re-scrape.`,
        log: [],
        pending: 0,
        total: models.length,
      });
    }

    // 3. Take one batch
    const batch = pending.slice(0, BATCH_SIZE);
    log.push(`Processing ${batch.length} of ${pending.length} pending models (${models.length} total have URLs)`);

    const results = { updated: 0, failed: 0, skipped: 0 };

    for (const model of batch) {
      const modelLog = [`[${model.model}]`];

      // Try Amazon first, then Flipkart — use whichever succeeds
      let newPrice = null;
      let priceSource = null;

      if (model.amazon_url) {
        const { price, error } = await fetchPrice(model.amazon_url, 'amazon');
        if (price) {
          newPrice = price;
          priceSource = 'amazon';
          modelLog.push(`Amazon: ₹${price.toLocaleString('en-IN')}`);
        } else {
          modelLog.push(`Amazon: failed (${error})`);
        }
      }

      if (!newPrice && model.flipkart_url) {
        const { price, error } = await fetchPrice(model.flipkart_url, 'flipkart');
        if (price) {
          newPrice = price;
          priceSource = 'flipkart';
          modelLog.push(`Flipkart: ₹${price.toLocaleString('en-IN')}`);
        } else {
          modelLog.push(`Flipkart: failed (${error})`);
        }
      }

      if (!newPrice) {
        modelLog.push('→ No price extracted — skipped update');
        log.push(modelLog.join(' '));
        results.failed++;
        // Still mark it as attempted today (so we don't retry every 5 min)
        await supabase.from('models').update({ price_last_updated: today }).eq('model_id', model.model_id);
        continue;
      }

      // Price changed? Log it
      const changed = model.current_price_inr && Math.abs(model.current_price_inr - newPrice) > 1;
      if (changed) {
        modelLog.push(`→ Price changed: ₹${Math.round(model.current_price_inr).toLocaleString('en-IN')} → ₹${Math.round(newPrice).toLocaleString('en-IN')}`);
      } else if (model.current_price_inr) {
        modelLog.push(`→ No change (₹${Math.round(newPrice).toLocaleString('en-IN')})`);
      } else {
        modelLog.push(`→ First price: ₹${Math.round(newPrice).toLocaleString('en-IN')}`);
      }

      // Update models table
      await supabase.from('models')
        .update({ current_price_inr: newPrice, price_last_updated: today })
        .eq('model_id', model.model_id);

      // Insert price_history (only if changed or never recorded)
      if (changed || !model.current_price_inr) {
        await supabase.from('price_history').insert({
          model_id: model.model_id,
          price: newPrice,
          source: priceSource,
          noted_date: today,
        });
      }

      log.push(modelLog.join(' '));
      results.updated++;
    }

    const stillPending = pending.length - batch.length;

    return res.status(200).json({
      success: true,
      message: `Batch done: ${results.updated} updated, ${results.failed} failed. ${stillPending > 0 ? `${stillPending} more pending — run again.` : 'All done for today.'}`,
      log,
      updated: results.updated,
      failed: results.failed,
      pending: stillPending,
      total: models.length,
    });

  } catch (e) {
    console.error('cron-ecom-scrape failed:', e);
    return res.status(500).json({ error: e.message, log });
  }
};
