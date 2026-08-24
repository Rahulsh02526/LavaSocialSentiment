// api/videos.js
// Merged: search-videos + save-video-selection + replace-video
// POST /api/videos?action=search     — fetch 20 candidates with thumbnails/views
// POST /api/videos?action=save       — save admin's manual selection
// POST /api/videos?action=replace    — replace video + clear old YT comments

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

const REGION = 'IN';
const NON_INDIA_SIGNALS = [
  'bangladesh','price in bd','bd price','taka','৳','dhaka','in bangladesh',
  'indonesia','harga','rupiah','jakarta','philippines','pilipinas','piso','manila',
  'pakistan','pkr','karachi','lahore','nepal','sri lanka','myanmar','malaysia',
  'nigeria','ghana','kenya','ethiopia',
];
function isNonIndia(item) {
  const s = ((item.snippet?.title||'')+(item.snippet?.channelTitle||'')).toLowerCase();
  return NON_INDIA_SIGNALS.some(sig => s.includes(sig)) || s.includes('#shorts') || s.includes('#short');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const action = req.query.action || 'search';
  const supabase = getSupabaseClient();
  const ytKey = process.env.YOUTUBE_API_KEY;

  try {
    // ── SEARCH ──
    if (action === 'search') {
      if (!ytKey) return res.status(500).json({ error: 'Missing YOUTUBE_API_KEY.' });
      const { model_id } = req.body || {};
      if (!model_id) return res.status(400).json({ error: 'model_id required.' });
      const today = new Date().toISOString().slice(0, 10);
      const { data: model } = await supabase.from('models').select('model_id, model, launch_date').eq('model_id', model_id).single();
      if (!model) return res.status(404).json({ error: 'Model not found.' });
      const publishedAfter = model.launch_date
        ? new Date(new Date(model.launch_date).getTime() - 3*24*60*60*1000).toISOString()
        : new Date('2025-01-01').toISOString();
      const query = encodeURIComponent(`"${model.model}"`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=50&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&publishedAfter=${publishedAfter}&key=${ytKey}`;
      const sr = await fetch(searchUrl);
      const sd = await sr.json();
      await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id });
      if (sd.error) return res.status(500).json({ error: `YouTube search failed: ${sd.error.message}` });
      const items = (sd.items||[]).filter(i => !isNonIndia(i));
      if (!items.length) return res.status(200).json({ videos: [], message: 'No India-relevant results found.' });
      const videoIds = items.map(i => i.id.videoId).join(',');
      const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${ytKey}`);
      const vd = await vr.json();
      await supabase.from('quota_log').insert({ log_date: today, units_used: 50, call_type: 'videos.list', model_id });
      const details = {};
      (vd.items||[]).forEach(v => { details[v.id] = v; });
      const enriched = items.map(item => {
        const d = details[item.id.videoId];
        if (!d) return null;
        const dur = d.contentDetails?.duration||'';
        if (/^PT[0-5]?\d?S$/.test(dur)||dur==='PT0S') return null;
        return { video_id: item.id.videoId, title: d.snippet.title, channel: d.snippet.channelTitle, channel_id: d.snippet.channelId, published_at: d.snippet.publishedAt, thumbnail: d.snippet.thumbnails?.medium?.url, view_count: parseInt(d.statistics?.viewCount||'0'), duration: dur };
      }).filter(Boolean).sort((a,b) => b.view_count - a.view_count).slice(0, 20);
      return res.status(200).json({ videos: enriched, model: model.model, quota_used: 150 });
    }

    // ── SAVE SELECTION ──
    if (action === 'save') {
      const { model_id, videos } = req.body || {};
      if (!model_id || !Array.isArray(videos) || !videos.length) return res.status(400).json({ error: 'model_id and videos required.' });
      if (videos.length > 11) return res.status(400).json({ error: 'Max 11 videos per model.' });
      await supabase.from('model_videos').delete().eq('model_id', model_id);
      await supabase.from('model_videos').insert(videos.map(v => ({ model_id, video_id: v.video_id, video_type: v.video_type||'reviewer', title: v.title||null, channel: v.channel||null, channel_id: v.channel_id||null, published_at: v.published_at||null, mapped_at: new Date().toISOString() })));
      await supabase.from('comments').delete().eq('model_id', model_id).eq('source', 'YouTube');
      await supabase.from('fetch_progress').upsert({ model_id, official_search_done: true, reviewer_search_done: true, status: 'searched', comments_fetched_at: null, updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
      return res.status(200).json({ success: true, videos_saved: videos.length, message: `${videos.length} video(s) saved. YT comments cleared.` });
    }

    // ── REPLACE ──
    if (action === 'replace') {
      const { model_id, video_id, video_type, title, channel, channel_id, replace_type } = req.body || {};
      if (!model_id || !video_id) return res.status(400).json({ error: 'model_id and video_id required.' });
      if (replace_type === 'all') {
        await supabase.from('model_videos').delete().eq('model_id', model_id);
      } else {
        await supabase.from('model_videos').delete().eq('model_id', model_id).eq('video_type', video_type||'reviewer');
      }
      await supabase.from('model_videos').insert({ model_id, video_id, video_type: video_type||'reviewer', title:title||null, channel:channel||null, channel_id:channel_id||null, mapped_at: new Date().toISOString() });
      await supabase.from('comments').delete().eq('model_id', model_id).eq('source', 'YouTube');
      await supabase.from('fetch_progress').upsert({ model_id, status: 'searched', comments_fetched_at: null, updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
      return res.status(200).json({ success: true, message: `Video replaced. Old YT comments cleared.` });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('videos.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};
