// api/bulk-update-ratings.js
// POST /api/bulk-update-ratings
// Body: { rows: [{model, source, ecom_rating, num_reviews, noted_date}] }
// Admin only — bulk updates ecom ratings from Excel upload.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required.' });
  }

  try {
    const supabase = getSupabaseClient();

    // get all models for name→id matching
    const { data: models } = await supabase.from('models').select('model_id, model');
    const modelMap = {};
    (models || []).forEach(m => { modelMap[m.model.toLowerCase().trim()] = m.model_id; });

    const results = [], errors = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      const modelName = String(row.model || '').trim();
      const source    = String(row.source || '').trim();
      const rating    = parseFloat(row.ecom_rating);

      if (!modelName || !source || isNaN(rating)) {
        errors.push(`Skipped: missing required fields for "${modelName || 'unknown'}"`);
        continue;
      }

      // find model_id by name (case-insensitive)
      const model_id = modelMap[modelName.toLowerCase()];
      if (!model_id) {
        errors.push(`Skipped: model not found — "${modelName}"`);
        continue;
      }

      const sourceLower = source.toLowerCase();
      const updateField = sourceLower.includes('amazon')   ? 'amazon_rating'   :
                          sourceLower.includes('flipkart') ? 'flipkart_rating'  : null;
      const countField  = sourceLower.includes('amazon')   ? 'amazon_reviews'   :
                          sourceLower.includes('flipkart') ? 'flipkart_reviews'  : null;

      if (!updateField) {
        errors.push(`Skipped: unknown source "${source}" for "${modelName}" — use Amazon or Flipkart`);
        continue;
      }

      const updateData = {
        [updateField]: rating,
        price_last_updated: today,
      };
      if (row.num_reviews && countField) {
        updateData[countField] = parseInt(row.num_reviews);
      }

      const { error: updateErr } = await supabase
        .from('models').update(updateData).eq('model_id', model_id);

      if (updateErr) {
        errors.push(`Error updating "${modelName}": ${updateErr.message}`);
        continue;
      }

      results.push({ model_id, model: modelName, source, rating });
    }

    res.status(200).json({
      success: true,
      updated: results.length,
      errors,
      message: `${results.length} rating(s) updated.${errors.length ? ` ${errors.length} skipped.` : ''}`,
    });
  } catch (e) {
    console.error('bulk-update-ratings failed:', e);
    res.status(500).json({ error: e.message });
  }
};
