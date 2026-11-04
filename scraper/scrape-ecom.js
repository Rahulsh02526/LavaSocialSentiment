// scraper/scrape-ecom.js
// ============================================================
// Daily e-com scraper — runs via GitHub Actions
// Reads amazon_url / flipkart_url from Supabase models table,
// visits each page with Playwright, extracts:
//   - Current price (base + variants if visible)
//   - Top reviews (up to 20 per platform)
// Updates Supabase:
//   - models.amazon_price / flipkart_price / current_price_inr
//   - price_history (one row per platform per day)
//   - scraped_comments (upsert by review hash)
// ============================================================

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// --- Supabase client (service role key — full access) ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // NOT the anon key — needs write access
);

const today = new Date().toISOString().slice(0, 10);

// ============================================================
// AMAZON SCRAPER
// ============================================================
async function scrapeAmazon(page, url, modelId) {
  const result = { price: null, variants: {}, reviews: [], error: null };

  try {
    // Navigate with realistic timeout; Amazon sometimes loads slowly
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the main price element to appear
    await page.waitForSelector('#corePriceDisplay_desktop_feature_div, .a-price', {
      timeout: 10000
    }).catch(() => {}); // Don't fail if selector not found

    // --- Extract base price ---
    // Amazon uses multiple price selectors depending on page type
    const priceText = await page.evaluate(() => {
      // Try corePriceDisplay first (most common for India)
      const corePrice = document.querySelector(
        '#corePriceDisplay_desktop_feature_div .a-price-whole'
      );
      if (corePrice) return corePrice.innerText;

      // Fallback: .a-price-whole (generic)
      const genericPrice = document.querySelector('.a-price-whole');
      if (genericPrice) return genericPrice.innerText;

      // Fallback: deal price
      const dealPrice = document.querySelector('#priceblock_dealprice');
      if (dealPrice) return dealPrice.innerText;

      return null;
    });

    if (priceText) {
      // Remove commas, ₹ symbol, whitespace and parse
      result.price = parseFloat(priceText.replace(/[₹,\s]/g, ''));
    }

    // --- Extract variant prices (RAM/ROM options) ---
    // Amazon shows variants as swatches with prices
    result.variants = await page.evaluate(() => {
      const variants = {};
      // Twister (variant selector) rows
      const twisterRows = document.querySelectorAll('#twister .a-row');
      twisterRows.forEach(row => {
        const label = row.querySelector('.a-form-label')?.innerText?.trim();
        const selected = row.querySelector('.a-button-selected .a-button-text')?.innerText?.trim();
        if (label && selected) {
          variants[label] = selected; // e.g. { "RAM": "6 GB", "Storage": "128 GB" }
        }
      });
      return variants;
    });

    // --- Extract top reviews (up to 20) ---
    // Look for review sections on the product page first
    const reviews = await page.evaluate(() => {
      const reviewEls = document.querySelectorAll('[data-hook="review"]');
      const reviews = [];

      reviewEls.forEach((el, i) => {
        if (i >= 20) return; // cap at 20

        const title = el.querySelector('[data-hook="review-title"] span:last-child')?.innerText?.trim();
        const body = el.querySelector('[data-hook="review-body"] span')?.innerText?.trim();
        const ratingText = el.querySelector('[data-hook="review-star-rating"] span')?.innerText?.trim();
        const rating = ratingText ? parseFloat(ratingText.split(' ')[0]) : null;
        const dateText = el.querySelector('[data-hook="review-date"]')?.innerText?.trim();
        const reviewer = el.querySelector('.a-profile-name')?.innerText?.trim();
        const verified = !!el.querySelector('[data-hook="avp-badge"]');
        const helpfulText = el.querySelector('[data-hook="helpful-vote-statement"]')?.innerText?.trim();
        const helpful = helpfulText ? parseInt(helpfulText.replace(/[^0-9]/g, '')) : 0;

        if (body) {
          reviews.push({ title, body, rating, dateText, reviewer, verified, helpful });
        }
      });
      return reviews;
    });

    // Parse dates and format reviews
    result.reviews = reviews.map(r => ({
      ...r,
      review_date: parseAmazonDate(r.dateText),
    }));

  } catch (err) {
    result.error = err.message;
    console.error(`  Amazon scrape failed for model ${modelId}:`, err.message);
  }

  return result;
}

// Parses "Reviewed in India on 15 October 2024" → "2024-10-15"
function parseAmazonDate(dateStr) {
  if (!dateStr) return null;
  try {
    const match = dateStr.match(/(\d+)\s+(\w+)\s+(\d{4})/);
    if (!match) return null;
    const months = {
      January: '01', February: '02', March: '03', April: '04',
      May: '05', June: '06', July: '07', August: '08',
      September: '09', October: '10', November: '11', December: '12'
    };
    const day = match[1].padStart(2, '0');
    const month = months[match[2]];
    const year = match[3];
    return month ? `${year}-${month}-${day}` : null;
  } catch { return null; }
}

// ============================================================
// FLIPKART SCRAPER
// ============================================================
async function scrapeFlipkart(page, url, modelId) {
  const result = { price: null, variants: {}, reviews: [], error: null };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Flipkart sometimes shows a login popup — close it
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button._2KpZ6l._2doB4z');
      if (closeBtn) closeBtn.click();
    });

    await page.waitForSelector('._30jeq3, ._16Jk6d', { timeout: 10000 }).catch(() => {});

    // --- Extract base price ---
    const priceText = await page.evaluate(() => {
      // ._30jeq3 is Flipkart's main price class
      const el = document.querySelector('._30jeq3._16Jk6d') ||
                 document.querySelector('._30jeq3') ||
                 document.querySelector('div[class*="Nx9bqj"]');
      return el?.innerText || null;
    });

    if (priceText) {
      result.price = parseFloat(priceText.replace(/[₹,\s]/g, ''));
    }

    // --- Extract variant options (storage/RAM pills) ---
    result.variants = await page.evaluate(() => {
      const variants = {};
      // Flipkart variant selectors — typically li elements with selected state
      const variantSections = document.querySelectorAll('._3_SrNK, ._1ovRPR');
      variantSections.forEach(section => {
        const label = section.querySelector('._2bXBBJ')?.innerText?.trim();
        const selected = section.querySelector('li._1mRRME, li._3LX39j')?.innerText?.trim();
        if (label && selected) variants[label] = selected;
      });
      return variants;
    });

    // --- Extract reviews ---
    // Scroll down to load reviews
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(2000);

    const reviews = await page.evaluate(() => {
      const reviewEls = document.querySelectorAll('._27M-vq, div[class*="col _2wzgFH"]');
      const reviews = [];

      reviewEls.forEach((el, i) => {
        if (i >= 20) return;

        const title = el.querySelector('._2-N8zT')?.innerText?.trim();
        const body = el.querySelector('.t-ZTKy, ._6K-7Co')?.innerText?.trim();
        const ratingEl = el.querySelector('._3LWZlK');
        const rating = ratingEl ? parseFloat(ratingEl.innerText) : null;
        const dateText = el.querySelector('._2sc7ZR')?.innerText?.trim();
        const reviewer = el.querySelector('._2NsDsR')?.innerText?.trim();

        if (body) {
          reviews.push({ title, body, rating, dateText, reviewer, verified: false, helpful: 0 });
        }
      });
      return reviews;
    });

    result.reviews = reviews.map(r => ({
      ...r,
      review_date: parseFlipkartDate(r.dateText),
    }));

  } catch (err) {
    result.error = err.message;
    console.error(`  Flipkart scrape failed for model ${modelId}:`, err.message);
  }

  return result;
}

// Parses "Nov, 2024" or "15 Nov 2024" → "2024-11-15"
function parseFlipkartDate(dateStr) {
  if (!dateStr) return null;
  try {
    const months = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    // "15 Nov 2024" format
    const full = dateStr.match(/(\d+)\s+(\w{3})\s+(\d{4})/);
    if (full) {
      return `${full[3]}-${months[full[2]] || '01'}-${full[1].padStart(2, '0')}`;
    }
    // "Nov, 2024" format — use 1st of month
    const monthOnly = dateStr.match(/(\w{3}),?\s+(\d{4})/);
    if (monthOnly) {
      return `${monthOnly[2]}-${months[monthOnly[1]] || '01'}-01`;
    }
    return null;
  } catch { return null; }
}

// ============================================================
// SAVE TO SUPABASE
// ============================================================
async function savePrice(modelId, platform, price) {
  if (!price || isNaN(price)) return;

  // Update the price column on models table
  const priceField = platform === 'amazon' ? 'amazon_price' : 'flipkart_price';
  await supabase.from('models').update({
    [priceField]: price,
    price_last_updated: today,
  }).eq('model_id', modelId);

  // Insert into price_history (upsert — one row per model+platform+date)
  const { error } = await supabase.from('price_history').upsert({
    model_id: modelId,
    platform,
    variant_label: null,       // base price — no variant specified
    price,
    source: `${platform}_scrape`,
    noted_date: today,
  }, {
    onConflict: 'model_id,platform,variant_label,noted_date',
    ignoreDuplicates: false,   // update if exists
  });

  if (error) console.error(`  price_history upsert failed:`, error.message);
}

async function saveCurrentPrice(modelId, amazonPrice, flipkartPrice) {
  // current_price_inr = lower of the two (best deal for consumer)
  const prices = [amazonPrice, flipkartPrice].filter(p => p && !isNaN(p));
  if (!prices.length) return;
  const current = Math.min(...prices);

  // Track which platform gave the lowest price (for "as of" source display in UI)
  const priceSource = (amazonPrice && flipkartPrice)
    ? (amazonPrice <= flipkartPrice ? 'amazon' : 'flipkart')
    : amazonPrice ? 'amazon' : 'flipkart';

  await supabase.from('models').update({
    current_price_inr: current,
    price_source: priceSource,
    price_last_updated: new Date().toISOString().slice(0, 10),
  }).eq('model_id', modelId);
}

async function saveReviews(modelId, platform, reviews) {
  if (!reviews.length) return;

  // Build rows for scraped_comments table
  const rows = reviews.map(r => {
    // Create a stable hash ID from platform + model + review text
    const hash = crypto
      .createHash('md5')
      .update(`${platform}_${modelId}_${r.body?.slice(0, 100) || ''}`)
      .digest('hex')
      .slice(0, 16);

    return {
      id: `${platform}_${modelId}_${hash}`,
      model_id: modelId,
      platform,
      review_title: r.title || null,
      review_text: r.body,
      rating: r.rating,
      reviewer_name: r.reviewer || null,
      review_date: r.review_date || null,
      verified_purchase: r.verified || false,
      helpful_votes: r.helpful || 0,
      scraped_at: new Date().toISOString(),
    };
  });

  // Upsert — don't re-tag already-tagged reviews
  const { error } = await supabase.from('scraped_comments').upsert(rows, {
    onConflict: 'id',
    ignoreDuplicates: true,    // keep existing tagged reviews as-is
  });

  if (error) console.error(`  scraped_comments upsert failed:`, error.message);
  else console.log(`  Saved ${rows.length} reviews for model ${modelId} [${platform}]`);
}

// ============================================================
// MAIN RUN
// ============================================================
async function main() {
  const startTime = Date.now();
  console.log(`\n=== SIP E-com Scraper — ${today} ===\n`);

  // Fetch all models that have at least one e-com URL
  const { data: models, error: fetchErr } = await supabase
    .from('models')
    .select('model_id, model, amazon_url, flipkart_url')
    .or('amazon_url.not.is.null,flipkart_url.not.is.null');

  if (fetchErr) {
    console.error('Failed to fetch models:', fetchErr.message);
    process.exit(1);
  }

  console.log(`Found ${models.length} models to scrape\n`);

  // Track run stats
  let succeeded = 0, failed = 0;
  const errors = [];

  // Launch Playwright with realistic browser settings to avoid bot detection
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',  // hide automation flag
    ],
  });

  for (const model of models) {
    console.log(`Processing: ${model.model} (ID: ${model.model_id})`);

    // Create a fresh context per model — fresh cookies, realistic viewport
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
    });
    const page = await context.newPage();

    // Block images/fonts/media to speed up scraping (we only need text/prices)
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,mp4,mp3}', r => r.abort());

    let amazonPrice = null, flipkartPrice = null;

    // --- Scrape Amazon ---
    if (model.amazon_url) {
      console.log(`  → Amazon: ${model.amazon_url}`);
      const result = await scrapeAmazon(page, model.amazon_url, model.model_id);
      amazonPrice = result.price;

      if (result.price) {
        console.log(`  ✓ Amazon price: ₹${result.price.toLocaleString('en-IN')}`);
        await savePrice(model.model_id, 'amazon', result.price);
      } else {
        console.log(`  ✗ Amazon price not found`);
        if (result.error) errors.push({ model: model.model, platform: 'amazon', error: result.error });
      }

      if (result.reviews.length) {
        console.log(`  ✓ ${result.reviews.length} Amazon reviews scraped`);
        await saveReviews(model.model_id, 'amazon', result.reviews);
      }

      // Small delay between requests — be polite to avoid rate limiting
      await page.waitForTimeout(2000 + Math.random() * 1000);
    }

    // --- Scrape Flipkart ---
    if (model.flipkart_url) {
      console.log(`  → Flipkart: ${model.flipkart_url}`);
      const result = await scrapeFlipkart(page, model.flipkart_url, model.model_id);
      flipkartPrice = result.price;

      if (result.price) {
        console.log(`  ✓ Flipkart price: ₹${result.price.toLocaleString('en-IN')}`);
        await savePrice(model.model_id, 'flipkart', result.price);
      } else {
        console.log(`  ✗ Flipkart price not found`);
        if (result.error) errors.push({ model: model.model, platform: 'flipkart', error: result.error });
      }

      if (result.reviews.length) {
        console.log(`  ✓ ${result.reviews.length} Flipkart reviews scraped`);
        await saveReviews(model.model_id, 'flipkart', result.reviews);
      }

      await page.waitForTimeout(2000 + Math.random() * 1000);
    }

    // Update current_price_inr (lower of two platforms)
    await saveCurrentPrice(model.model_id, amazonPrice, flipkartPrice);

    if (amazonPrice || flipkartPrice) succeeded++;
    else failed++;

    await context.close();
  }

  await browser.close();

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${duration}s — ${succeeded} succeeded, ${failed} failed ===`);

  // Log this run to scrape_log table
  await supabase.from('scrape_log').insert({
    run_date: today,
    scrape_type: 'price_and_comments',
    models_attempted: models.length,
    models_succeeded: succeeded,
    models_failed: failed,
    errors: errors.length ? errors : null,
    duration_seconds: parseFloat(duration),
  });

  // Exit with error code if too many failures (GitHub Actions will mark run as failed)
  if (failed > models.length * 0.5) {
    console.error('More than 50% of models failed — check bot detection or selectors');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
