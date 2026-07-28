// api/search-videos.js
// POST /api/search-videos
// Body: { model_id }
// Fetches up to 20 candidate YouTube videos for a model with full details
// (title, channel, views, thumbnail, publish date) so admin can manually select
// which ones to actually map. Two-step: search.list (100 units) + videos.list (50 units).

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

const REGION = 'IN';

const NON_INDIA_SIGNALS = [
  'bangladesh', 'price in bd', 'bd price', 'taka', '৳', 'dhaka',
  'unboxing bd', 'review bd', 'bd unboxing', 'in bangladesh',
  'indonesia', 'harga', 'rupiah', 'rp.', 'jakarta',
  'philippines', 'pilipinas', 'piso', 'manila', 'presyo',
  'pakistan', 'pkr', 'karachi', 'lahore', 'in pakistan',
  'nepal', 'sri lanka', 'myanmar', 'malaysia', 'vietnam',
  'nigeria', 'ghana', 'kenya', 'ethiopia',
];

function isNonIndia(item) {
  const combined = ((item.snippet?.title || '') + ' ' + (item.snippet?.channelTitle || '')).toLowerCase();
  for (const sig of NON_INDIA_SIGNALS) {
    if (combined.includes(sig)) return true;
  }
  // Reject Shorts
  if (combined.includes('#shorts') || combined.includes('#short')) return true;
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY.' });

  const { model_id } = req.body || {};
  if (!model_id) return res.status(400).json({ error: 'model_id required.' });

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    // get model details
    const { data: model, error: modelErr } = await supabase
      .from('models').select('model_id, model, launch_date').eq('model_id', model_id).single();
    if (modelErr || !model) return res.status(404).json({ error: 'Model not found.' });

    // publishedAfter = launch_date - 3 days
    const publishedAfter = model.launch_date
      ? new Date(new Date(model.launch_date).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
      : new Date('2025-01-01').toISOString();

    // Step 1: search for up to 25 candidates (we'll filter down to 20)
    const query = encodeURIComponent(`"${model.model}"`);
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=50&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&publishedAfter=${publishedAfter}&key=${ytKey}`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    // log quota usage
    await supabase.from('quota_log').insert({
      log_date: today, units_used: 100, call_type: 'search.list', model_id,
    });

    if (searchData.error) {
      return res.status(500).json({ error: `YouTube search failed: ${searchData.error.message}` });
    }

    const items = (searchData.items || []).filter(item => !isNonIndia(item));
    if (!items.length) {
      return res.status(200).json({ videos: [], message: 'No results found after filtering. Try manual URL.' });
    }

    // Step 2: get view counts + proper thumbnails via videos.list
    const videoIds = items.map(item => item.id.videoId).join(',');
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${ytKey}`;
    const videosRes = await fetch(videosUrl);
    const videosData = await videosRes.json();

    await supabase.from('quota_log').insert({
      log_date: today, units_used: 50, call_type: 'videos.list', model_id,
    });

    // build enriched video list, sorted by view count descending
    const videoDetails = {};
    (videosData.items || []).forEach(v => { videoDetails[v.id] = v; });

    const enriched = items
      .map(item => {
        const vid = item.id.videoId;
        const detail = videoDetails[vid];
        if (!detail) return null;

        // filter out Shorts by duration (< 60 seconds)
        const dur = detail.contentDetails?.duration || '';
        const isShort = /^PT[0-5]?\d?S$/.test(dur) || /^PT[0-5]?\dS$/.test(dur) || dur === 'PT0S';

        return {
          video_id: vid,
          title: detail.snippet.title,
          channel: detail.snippet.channelTitle,
          channel_id: detail.snippet.channelId,
          published_at: detail.snippet.publishedAt,
          thumbnail: detail.snippet.thumbnails?.medium?.url || detail.snippet.thumbnails?.default?.url,
          view_count: parseInt(detail.statistics?.viewCount || '0', 10),
          like_count: parseInt(detail.statistics?.likeCount || '0', 10),
          duration: dur,
          is_short: isShort,
        };
      })
      .filter(v => v && !v.is_short)
      .sort((a, b) => b.view_count - a.view_count)
      .slice(0, 20);

    res.status(200).json({
      videos: enriched,
      model: model.model,
      quota_used: 150,
    });
  } catch (e) {
    console.error('search-videos failed:', e);
    res.status(500).json({ error: e.message });
  }
};
