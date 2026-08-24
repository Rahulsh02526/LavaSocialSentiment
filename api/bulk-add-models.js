// api/bulk-add-models.js
// POST /api/bulk-add-models
// Body: { rows: [{model, brand, launch_date, launch_price_inr, ...specs}] }
// Admin only — bulk inserts models + specs from Excel upload.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

function deriveSegment(price) {
  if (price < 10000) return 'budget';
  if (price < 15000) return 'entry_mid';
  if (price < 20000) return 'mid';
  if (price < 25000) return 'upper_mid';
  return 'premium_mid';
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required.' });
  }

  try {
    const supabase = getSupabaseClient();

    // get max model_id
    const { data: maxRow } = await supabase
      .from('models').select('model_id').order('model_id', { ascending: false }).limit(1).single();
    let nextId = (maxRow?.model_id || 0) + 1;

    const results = [], errors = [];

    for (const row of rows) {
      const { model, brand, launch_date, launch_price_inr } = row;
      if (!model || !brand || !launch_date || !launch_price_inr) {
        errors.push(`Skipped: missing required fields for "${model || 'unknown'}"`);
        continue;
      }

      const price = parseFloat(launch_price_inr);
      const modelId = nextId++;

      // insert model
      const { error: modelErr } = await supabase.from('models').insert({
        model_id: modelId,
        model: String(model).trim(),
        brand: String(brand).toLowerCase().trim(),
        launch_date: String(launch_date).slice(0, 10),
        launch_price_inr: price,
        current_price_inr: price,
        amazon_available:   row.amazon_available   || 'No',
        flipkart_available: row.flipkart_available || 'No',
        price_segment: row.price_segment || deriveSegment(price),
        sentiment_frozen_at: addMonths(launch_date, 6),
        price_frozen_at:     addMonths(launch_date, 12),
        rank_original: `#${modelId}`,
      });

      if (modelErr) {
        errors.push(`Error inserting "${model}": ${modelErr.message}`);
        nextId--;
        continue;
      }

      // insert specs if any spec field present
      const hasSpecs = row.processor || row.display || row.battery_mah;
      if (hasSpecs) {
        const parseArr = (v) => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
        await supabase.from('specs').insert({
          model_id:         modelId,
          processor:        row.processor        || null,
          ram_variants:     parseArr(row.ram_variants),
          storage_variants: parseArr(row.storage_variants),
          display:          row.display          || null,
          battery_mah:      row.battery_mah      ? parseInt(row.battery_mah)      : null,
          fast_charging_w:  row.fast_charging_w  ? parseInt(row.fast_charging_w)  : null,
          rear_camera:      row.rear_camera      || null,
          front_camera:     row.front_camera     || null,
          os:               row.os               || null,
          connectivity:     row.connectivity     || null,
          weight_g:         row.weight_g         ? parseInt(row.weight_g)         : null,
          source_confidence: 'excel_upload',
        });
      }

      // fetch_progress
      await supabase.from('fetch_progress').insert({
        model_id: modelId, status: 'pending',
        official_search_done: false, reviewer_search_done: false,
      });

      // initial price history
      await supabase.from('price_history').insert({
        model_id: modelId, price, source: 'launch', noted_date: launch_date,
      });

      results.push({ model_id: modelId, model });
    }

    res.status(200).json({
      success: true,
      inserted: results.length,
      errors,
      message: `${results.length} model(s) added successfully.${errors.length ? ` ${errors.length} skipped.` : ''}`,
      models: results,
    });
  } catch (e) {
    console.error('bulk-add-models failed:', e);
    res.status(500).json({ error: e.message });
  }
};
