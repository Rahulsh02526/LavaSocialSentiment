// api/models.js
// Merged: add-model + bulk-add-models
// POST /api/models?action=add        — single model add
// POST /api/models?action=bulk       — bulk add from Excel upload

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

async function insertModel(supabase, row, modelId) {
  const price = parseFloat(row.launch_price_inr);
  const { error: modelErr } = await supabase.from('models').insert({
    model_id: modelId,
    model: String(row.model).trim(),
    brand: String(row.brand).toLowerCase().trim(),
    launch_date: String(row.launch_date).slice(0, 10),
    launch_price_inr: price,
    current_price_inr: price,
    amazon_available:   row.amazon_available   || 'No',
    flipkart_available: row.flipkart_available || 'No',
    price_segment: row.price_segment || deriveSegment(price),
    sentiment_frozen_at: addMonths(row.launch_date, 6),
    price_frozen_at:     addMonths(row.launch_date, 12),
    rank_original: `#${modelId}`,
  });
  if (modelErr) throw new Error(`Model insert failed: ${modelErr.message}`);

  if (row.processor || row.display || row.battery_mah) {
    const parseArr = (v) => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
    await supabase.from('specs').insert({
      model_id: modelId,
      processor:        row.processor        || null,
      ram_variants:     Array.isArray(row.ram_variants) ? row.ram_variants : parseArr(row.ram_variants),
      storage_variants: Array.isArray(row.storage_variants) ? row.storage_variants : parseArr(row.storage_variants),
      display:          row.display          || null,
      battery_mah:      row.battery_mah      ? parseInt(row.battery_mah)      : null,
      fast_charging_w:  row.fast_charging_w  ? parseInt(row.fast_charging_w)  : null,
      rear_camera:      row.rear_camera      || null,
      front_camera:     row.front_camera     || null,
      os:               row.os               || null,
      connectivity:     row.connectivity     || null,
      weight_g:         row.weight_g         ? parseInt(row.weight_g)         : null,
      source_confidence: 'manual',
    });
  }

  await supabase.from('fetch_progress').insert({
    model_id: modelId, status: 'pending',
    official_search_done: false, reviewer_search_done: false,
  });

  await supabase.from('price_history').insert({
    model_id: modelId, price: parseFloat(row.launch_price_inr),
    source: 'launch', noted_date: row.launch_date,
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const action = req.query.action || 'add';
  const supabase = getSupabaseClient();

  // get next model_id
  const { data: maxRow } = await supabase
    .from('models').select('model_id').order('model_id', { ascending: false }).limit(1).single();
  let nextId = (maxRow?.model_id || 0) + 1;

  try {
    if (action === 'add') {
      // Single model
      const row = req.body || {};
      if (!row.model || !row.brand || !row.launch_date || !row.launch_price_inr) {
        return res.status(400).json({ error: 'model, brand, launch_date, launch_price_inr required.' });
      }
      await insertModel(supabase, row, nextId);
      return res.status(200).json({
        success: true, model_id: nextId,
        message: `"${row.model}" added as model_id ${nextId}.`,
      });
    }

    if (action === 'bulk') {
      const { rows } = req.body || {};
      if (!Array.isArray(rows) || !rows.length) {
        return res.status(400).json({ error: 'rows array required.' });
      }
      const results = [], errors = [];
      for (const row of rows) {
        if (!row.model || !row.brand || !row.launch_date || !row.launch_price_inr) {
          errors.push(`Skipped: missing required fields for "${row.model || 'unknown'}"`);
          continue;
        }
        try {
          await insertModel(supabase, row, nextId);
          results.push({ model_id: nextId, model: row.model });
          nextId++;
        } catch (e) {
          errors.push(`Error inserting "${row.model}": ${e.message}`);
        }
      }
      return res.status(200).json({
        success: true, inserted: results.length, errors,
        message: `${results.length} model(s) added.${errors.length ? ` ${errors.length} skipped.` : ''}`,
        models: results,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('models.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};
