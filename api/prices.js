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

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('prices.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};
