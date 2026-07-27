// api/replace-video.js
// POST /api/replace-video
// Body: { model_id, video_id, video_type, title, channel, channel_id }
// Replaces ALL videos for a model (or a specific video_type) and deletes
// all existing YouTube comments for that model so fresh ones get fetched next cron.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { model_id, video_id, video_type, title, channel, channel_id, replace_type } = req.body || {};
  if (!model_id || !video_id) return res.status(400).json({ error: 'model_id and video_id required.' });

  try {
    const supabase = getSupabaseClient();

    // 1. Delete the specific video type (or all if replace_type = 'all')
    if (replace_type === 'all') {
      await supabase.from('model_videos').delete().eq('model_id', model_id);
    } else {
      await supabase.from('model_videos').delete().eq('model_id', model_id).eq('video_type', video_type || 'reviewer');
    }

    // 2. Insert the new video
    const { error: insertErr } = await supabase.from('model_videos').insert({
      model_id,
      video_id,
      video_type: video_type || 'reviewer',
      title: title || null,
      channel: channel || null,
      channel_id: channel_id || null,
      mapped_at: new Date().toISOString(),
    });
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    // 3. Delete all YouTube comments for this model (clean slate)
    const { error: delErr } = await supabase
      .from('comments')
      .delete()
      .eq('model_id', model_id)
      .eq('source', 'YouTube');
    if (delErr) throw new Error(`Comment delete failed: ${delErr.message}`);

    // 4. Reset fetch_progress so cron re-fetches comments for this model
    await supabase.from('fetch_progress').upsert({
      model_id,
      status: 'searched',
      comments_fetched_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'model_id' });

    res.status(200).json({ success: true, message: `Video replaced and ${replace_type === 'all' ? 'all' : video_type} videos cleared. Old YT comments deleted. Cron will fetch fresh comments next run.` });
  } catch (e) {
    console.error('replace-video failed:', e);
    res.status(500).json({ error: e.message });
  }
};
