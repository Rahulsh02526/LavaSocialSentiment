// api/save-video-selection.js
// POST /api/save-video-selection
// Body: { model_id, videos: [{video_id, title, channel, channel_id, published_at, video_type}] }
// Replaces all mapped videos for a model with the admin's manual selection,
// deletes old YT comments for a clean slate, resets fetch_progress.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { model_id, videos } = req.body || {};
  if (!model_id || !Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({ error: 'model_id and at least one video required.' });
  }
  if (videos.length > 11) {
    return res.status(400).json({ error: 'Maximum 11 videos per model (1 official + 10 reviewers).' });
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Clear existing video mappings
    await supabase.from('model_videos').delete().eq('model_id', model_id);

    // 2. Insert new selection
    const rows = videos.map(v => ({
      model_id,
      video_id: v.video_id,
      video_type: v.video_type || 'reviewer',
      title: v.title || null,
      channel: v.channel || null,
      channel_id: v.channel_id || null,
      published_at: v.published_at || null,
      mapped_at: new Date().toISOString(),
    }));
    const { error: insertErr } = await supabase.from('model_videos').insert(rows);
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    // 3. Delete old YT comments (clean slate — new videos = fresh comments)
    await supabase.from('comments').delete().eq('model_id', model_id).eq('source', 'YouTube');

    // 4. Reset fetch_progress — mark searches done, comments not yet fetched
    await supabase.from('fetch_progress').upsert({
      model_id,
      official_search_done: true,
      reviewer_search_done: true,
      status: 'searched',
      comments_fetched_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'model_id' });

    res.status(200).json({
      success: true,
      videos_saved: videos.length,
      message: `${videos.length} video(s) saved. Old YT comments cleared. Cron will fetch fresh comments on next run.`,
    });
  } catch (e) {
    console.error('save-video-selection failed:', e);
    res.status(500).json({ error: e.message });
  }
};
