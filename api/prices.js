// api/prices.js
// Merged: update-price + bulk-update-ratings
// POST /api/prices?action=update     — single price update
// POST /api/prices?action=ratings    — bulk ratings from Excel

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const action = req.query.action || 'update';
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
        }));

        // insert all assets in one batch — delete existing first to avoid duplicates
        await supabase.from('marketing_assets').delete().eq('model_id', model_id);
        if (toInsert.length > 0) {
          const { error: insertErr } = await supabase.from('marketing_assets').insert(toInsert);
          if (insertErr) { errors.push(`Insert failed for "${modelName}": ${insertErr.message}`); continue; }
        }

        results.push({ model: modelName, assets_added: toInsert.length });
      }

      const totalAssets = results.reduce((s, r) => s + r.assets_added, 0);
      return res.status(200).json({
        success: true,
        processed: results.length,
        errors,
        message: `${totalAssets} assets added across ${results.length} models.`,
      });
    }

    return res.status(400).json({ error: `Unknown action: \${action}` });
  } catch (e) {
    console.error('prices.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};
