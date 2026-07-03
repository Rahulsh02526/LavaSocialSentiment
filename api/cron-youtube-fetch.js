// api/cron-youtube-fetch.js
// One run = one model, one operation (either official search OR reviewer search OR comment fetch).
// This keeps each invocation well under 60 seconds.
// With daily cron + 3 operations per model = ~58*3/1 = 174 runs total = ~3 days to cover all 58 models.
// Quota-safe: max 2 search calls per run = 200 units, well within daily caps.

const { getSupabaseClient } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');

const MAX_REVIEWER_VIDEOS = 10;
const REGION = 'IN';

module.exports = async (req, res) => {
  const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0'
    || req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const isAdminTrigger = verifyToken(req.headers['x-auth-token'], 'admin');
  if (!isVercelCron && !isAdminTrigger) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY.' });

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    // today's quota
    const { data: quotaRows } = await supabase.from('quota_log').select('call_type, units_used').eq('log_date', today);
    let searchCallsToday = 0, unitsToday = 0;
    (quotaRows || []).forEach(r => { unitsToday += r.units_used; if (r.call_type === 'search.list') searchCallsToday++; });

    if (searchCallsToday >= 90) return res.status(200).json({ message: 'Search quota reached for today. Will resume tomorrow.', searchCallsToday, unitsToday });
    if (unitsToday >= 9000) return res.status(200).json({ message: 'Unit quota reached for today. Will resume tomorrow.', unitsToday });

    // get all models and their progress
    const { data: models } = await supabase.from('models').select('model_id, model, brand').order('model_id');
    const { data: progressRows } = await supabase.from('fetch_progress').select('*');
    const progress = {};
    (progressRows || []).forEach(p => { progress[p.model_id] = p; });

    // ensure all models have a progress row
    const missing = models.filter(m => !progress[m.model_id]);
    if (missing.length) {
      await supabase.from('fetch_progress').insert(missing.map(m => ({ model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false })));
      missing.forEach(m => { progress[m.model_id] = { model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false }; });
    }

    // find the FIRST model that needs work, do ONE operation, return
    for (const model of models) {
      const p = progress[model.model_id] || {};

      // Priority 1: official video search not done yet
      if (!p.official_search_done) {
        const query = encodeURIComponent(`${model.model} official launch video`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

        if (!data.error && data.items?.length) {
          const brand = (model.brand || '').toLowerCase();
          const sorted = data.items.sort((a, b) => {
            const aOff = a.snippet.channelTitle.toLowerCase().includes(brand) ? 1 : 0;
            const bOff = b.snippet.channelTitle.toLowerCase().includes(brand) ? 1 : 0;
            return bOff - aOff;
          });
          const top = sorted[0];
          await supabase.from('model_videos').upsert({
            model_id: model.model_id, video_id: top.id.videoId, video_type: 'official',
            title: top.snippet.title, channel: top.snippet.channelTitle,
            channel_id: top.snippet.channelId, published_at: top.snippet.publishedAt,
            mapped_at: new Date().toISOString(),
          }, { onConflict: 'model_id,video_id' });
        }
        await supabase.from('fetch_progress').upsert({ model_id: model.model_id, official_search_done: true, updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
        return res.status(200).json({ message: `Official video searched for "${model.model}"`, searchCallsToday: searchCallsToday + 1, unitsToday: unitsToday + 100 });
      }

      // Priority 2: reviewer videos search not done yet
      if (!p.reviewer_search_done) {
        const query = encodeURIComponent(`${model.model} review India`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=${MAX_REVIEWER_VIDEOS}&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

        if (!data.error && data.items?.length) {
          const rows = data.items.map(item => ({
            model_id: model.model_id, video_id: item.id.videoId, video_type: 'reviewer',
            title: item.snippet.title, channel: item.snippet.channelTitle,
            channel_id: item.snippet.channelId, published_at: item.snippet.publishedAt,
            mapped_at: new Date().toISOString(),
          }));
          await supabase.from('model_videos').upsert(rows, { onConflict: 'model_id,video_id' });
        }
        await supabase.from('fetch_progress').upsert({ model_id: model.model_id, reviewer_search_done: true, status: 'searched', updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
        return res.status(200).json({ message: `Reviewer videos searched for "${model.model}"`, searchCallsToday: searchCallsToday + 1, unitsToday: unitsToday + 100 });
      }

      // Priority 3: fetch new comments from mapped videos
      const { data: videos } = await supabase.from('model_videos').select('*').eq('model_id', model.model_id);
      if (!videos?.length) {
        await supabase.from('fetch_progress').upsert({ model_id: model.model_id, status: 'fetched', comments_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
        continue;
      }

      // check if this model's comments were fetched recently (within last 24h) — skip if so
      const lastFetch = p.comments_fetched_at ? new Date(p.comments_fetched_at) : null;
      const hoursSinceFetch = lastFetch ? (Date.now() - lastFetch.getTime()) / 3600000 : 999;
      if (hoursSinceFetch < 20) continue; // already fetched today, move to next model

      let newTotal = 0;
      for (const video of videos) {
        if (unitsToday >= 9000) break;
        const cr = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${video.video_id}&maxResults=100&order=time&textFormat=plainText&key=${ytKey}`);
        const cd = await cr.json();
        unitsToday += 1;
        await supabase.from('quota_log').insert({ log_date: today, units_used: 1, call_type: 'commentThreads.list', model_id: model.model_id });
        if (cd.error) continue;

        const newestSeen = video.newest_comment_seen ? new Date(video.newest_comment_seen) : null;
        let newestInBatch = newestSeen;
        const rows = [];
        for (const item of (cd.items || [])) {
          const publishedAt = item.snippet.topLevelComment.snippet.publishedAt;
          const commentTime = new Date(publishedAt);
          if (newestSeen && commentTime <= newestSeen) continue;
          if (!newestInBatch || commentTime > newestInBatch) newestInBatch = commentTime;
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          rows.push({ id: `YouTube_${model.model_id}_${hashText(text)}`, model_id: model.model_id, source: 'YouTube', comment_text: text, comment_date: publishedAt.slice(0, 10) });
        }
        if (rows.length) {
          await supabase.from('comments').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
          newTotal += rows.length;
        }
        await supabase.from('model_videos').update({ last_fetched_at: new Date().toISOString(), newest_comment_seen: newestInBatch ? newestInBatch.toISOString() : video.newest_comment_seen }).eq('id', video.id);
      }

      await supabase.from('fetch_progress').upsert({ model_id: model.model_id, status: 'fetched', comments_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
      return res.status(200).json({ message: `Comments fetched for "${model.model}": ${newTotal} new`, unitsToday });
    }

    return res.status(200).json({ message: 'All models up to date for today.', unitsToday });
  } catch (e) {
    console.error('cron failed:', e);
    res.status(500).json({ error: e.message });
  }
};

function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(36);
}
