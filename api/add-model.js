// api/add-model.js
// POST /api/add-model
// Admin only — adds a new model + specs + fetch_progress row in one shot.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const {
    // model fields
    model, brand, launch_date, launch_price_inr,
    amazon_available, flipkart_available, price_segment,
    // spec fields
    processor, ram_variants, storage_variants, display,
    battery_mah, fast_charging_w, rear_camera, front_camera,
    os, connectivity, weight_g,
  } = req.body || {};

  if (!model || !brand || !launch_date || !launch_price_inr) {
    return res.status(400).json({ error: 'model, brand, launch_date, launch_price_inr are required.' });
  }

  try {
    const supabase = getSupabaseClient();

    // get next model_id
    const { data: maxRow } = await supabase
      .from('models').select('model_id').order('model_id', { ascending: false }).limit(1).single();
    const nextId = (maxRow?.model_id || 0) + 1;

    // compute frozen dates (6 months sentiment, 12 months price)
    const launch = new Date(launch_date);
    const addMonths = (d, m) => {
      const r = new Date(d);
      r.setMonth(r.getMonth() + m);
      return r.toISOString().slice(0, 10);
    };
    const sentiment_frozen_at = addMonths(launch, 6);
    const price_frozen_at     = addMonths(launch, 12);

    // insert model
    const { error: modelErr } = await supabase.from('models').insert({
      model_id: nextId,
      model: model.trim(),
      brand: brand.toLowerCase().trim(),
      launch_date,
      launch_price_inr: parseFloat(launch_price_inr),
      amazon_available:  amazon_available  || 'No',
      flipkart_available: flipkart_available || 'No',
      price_segment: price_segment || deriveSegment(parseFloat(launch_price_inr)),
      sentiment_frozen_at,
      price_frozen_at,
      rank_original: `#${nextId}`,
    });
    if (modelErr) throw new Error(`Model insert failed: ${modelErr.message}`);

    // insert specs (optional — skip if no spec data provided)
    if (processor || display || battery_mah) {
      const { error: specErr } = await supabase.from('specs').insert({
        model_id: nextId,
        processor: processor || null,
        ram_variants:     Array.isArray(ram_variants)     ? ram_variants     : (ram_variants     ? [ram_variants]     : []),
        storage_variants: Array.isArray(storage_variants) ? storage_variants : (storage_variants ? [storage_variants] : []),
        display:          display          || null,
        battery_mah:      battery_mah      ? parseInt(battery_mah)      : null,
        fast_charging_w:  fast_charging_w  ? parseInt(fast_charging_w)  : null,
        rear_camera:      rear_camera      || null,
        front_camera:     front_camera     || null,
        os:               os               || null,
        connectivity:     connectivity     || null,
        weight_g:         weight_g         ? parseInt(weight_g)         : null,
        source_confidence: 'manual',
      });
      if (specErr) throw new Error(`Spec insert failed: ${specErr.message}`);
    }

    // insert fetch_progress so cron picks it up
    await supabase.from('fetch_progress').insert({
      model_id: nextId, status: 'pending',
      official_search_done: false, reviewer_search_done: false,
    });

    res.status(200).json({
      success: true,
      model_id: nextId,
      message: `"${model}" added as model_id ${nextId}. Specs saved. YT fetch will auto-run on next cron.`,
    });
  } catch (e) {
    console.error('add-model failed:', e);
    res.status(500).json({ error: e.message });
  }
};

function deriveSegment(price) {
  if (price < 10000)  return 'budget';
  if (price < 15000)  return 'entry_mid';
  if (price < 20000)  return 'mid';
  if (price < 25000)  return 'upper_mid';
  return 'premium_mid';
}
