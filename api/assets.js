// api/assets.js
// POST   /api/assets         — add a marketing asset { model_id, type, platform, campaign_name, date, url, tags, notes }
// DELETE /api/assets?id=...  — remove a marketing asset by id

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  const supabase = getSupabaseClient();

  if (req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { model_id, type, platform, campaign_name, date, url, tags, notes } = req.body || {};
    if (!model_id || !url) return res.status(400).json({ error: 'model_id and url are required.' });

    try {
      const id = 'asset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const { data, error } = await supabase.from('marketing_assets').insert({
        id, model_id, type: type || 'image', platform: platform || 'Other',
        campaign_name: campaign_name || null, asset_date: date || null,
        url, tags: tags || [], notes: notes || null,
      }).select().single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ asset: data });
    } catch (e) {
      console.error('POST /api/assets failed:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const id = req.query?.id;
    if (!id) return res.status(400).json({ error: 'id query param is required.' });
    try {
      const { error } = await supabase.from('marketing_assets').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ deleted: id });
    } catch (e) {
      console.error('DELETE /api/assets failed:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
