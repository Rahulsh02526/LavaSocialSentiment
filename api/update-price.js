// api/update-price.js
// POST /api/update-price
// Body: { model_id, new_price, source }
// Updates current_price_inr on models table + inserts a price_history row.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { model_id, new_price, source } = req.body || {};
  if (!model_id || !new_price) return res.status(400).json({ error: 'model_id and new_price required.' });

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    // get model name for response
    const { data: model } = await supabase.from('models').select('model, current_price_inr').eq('model_id', model_id).single();

    // update current price + last updated date on models table
    await supabase.from('models').update({
      current_price_inr:   new_price,
      price_last_updated:  today,
    }).eq('model_id', model_id);

    // insert price history row
    await supabase.from('price_history').insert({
      model_id,
      price:      new_price,
      source:     source || 'manual',
      noted_date: today,
    });

    res.status(200).json({
      success: true,
      message: `Price updated for "${model?.model || model_id}": ₹${new_price.toLocaleString('en-IN')} (${source || 'manual'})`,
    });
  } catch (e) {
    console.error('update-price failed:', e);
    res.status(500).json({ error: e.message });
  }
};
