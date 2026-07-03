// api/cron-youtube-fetch.js
// Daily cron: maps up to 11 videos per model (1 official + 10 top reviewers),
// India only (regionCode=IN), ranked by view count.
// 2 searches per model (official + reviewers) — one-time, ~2 days for all 58 models.

const { getSupabaseClient } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');

const BATCH_SIZE = 6;
const SEARCH_DAILY_CAP = 90;
const UNITS_DAILY_CAP = 9000;
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

    const { data: quotaRows } = await supabase.from('quota_log').select('call_type, units_used').eq('log_date', today);
    let searchCallsToday = 0, unitsToday = 0;
    (quotaRows || []).forEach(r => { unitsToday += r.units_used; if (r.call_type === 'search.list') searchCallsToday++; });

    const log = [];

    const { data: models } = await supabase.from('models').select('model_id, model, brand').order('model_id');
    const { data: progressRows } = await supabase.from('fetch_progress').select('*');
    const progressByModel = {};
    (progressRows || []).forEach(p => { progressByModel[p.model_id] = p; });

    const missingProgress = models.filter(m => !progressByModel[m.model_id]);
    if (missingProgress.length) {
      await supabase.from('fetch_progress').insert(missingProgress.map(m => ({ model_id: m.model_id, status: 'pending' })));
      missingProgress.forEach(m => { progressByModel[m.model_id] = { model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false }; });
    }

    const needsSearch = models.filter(m => { const p = progressByModel[m.model_id] || {}; return !p.official_search_done || !p.reviewer_search_done; });
    const needsComments = models.filter(m => { const p = progressByModel[m.model_id] || {}; return p.official_search_done && p.reviewer_search_done; });
    const batch = [...needsSearch, ...needsComments].slice(0, BATCH_SIZE);

    if (batch.length === 0) return res.status(200).json({ message: 'All models mapped and up to date.', log });

    let processed = 0;

    for (const model of batch) {
      const progress = progressByModel[model.model_id] || {};

      // OFFICIAL VIDEO SEARCH
      if (!progress.official_search_done) {
        if (searchCallsToday >= SEARCH_DAILY_CAP) { log.push(`Search cap reached before "${model.model}"`); break; }
        const query = encodeURIComponent(`${model.model} official launch video`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        searchCallsToday++; unitsToday += 100;
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
          log.push(`Official: "${model.model}" → "${top.snippet.title}" (${top.snippet.channelTitle})`);
        } else {
          log.push(`No official video for "${model.model}"`);
        }
        await supabase.from('fetch_progress').upsert({ model_id: model.model_id, official_search_done: true, updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
        progress.official_search_done = true;
      }

      // REVIEWER VIDEOS SEARCH
      if (!progress.reviewer_search_done) {
        if (searchCallsToday >= SEARCH_DAILY_CAP) { log.push(`Search cap reached at reviewer search for "${model.model}"`); break; }
        const query = encodeURIComponent(`${model.model} review India`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=${MAX_REVIEWER_VIDEOS}&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        searchCallsToday++; unitsToday += 100;
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

        if (!data.error && data.items?.length) {
          const rows = data.items.map(item => ({
            model_id: model.model_id, video_id: item.id.videoId, video_type: 'reviewer',
            title: item.snippet.title, channel: item.snippet.channelTitle,
            channel_id: item.snippet.channelId, published_at: item.snippet.publishedAt,
            mapped_at: new Date().toISOString(),
          }));
          await supabase.from('model_videos').upsert(rows, { onConflict: 'model_id,video_id' });
          log.push(`${rows.length} reviewer videos for "${model.model}"`);
        }
        await supabase.from('fetch_progress').upsert({ model_id: model.model_id, reviewer_search_done: true, status: 'searched', updated_at: new Date().toISOString() }, { onConflict: 'model_id' });
        progress.reviewer_search_done = true;
        processed++;
      }

      // FETCH COMMENTS
      if (progress.official_search_done && progress.reviewer_search_done) {
        if (unitsToday >= UNITS_DAILY_CAP) { log.push(`Unit cap reached, skipping comments for "${model.model}"`); break; }
        const { data: videos } = await supabase.from('model_videos').select('*').eq('model_id', model.model_id);
        if (!videos?.length) continue;

        let newTotal = 0;
        for (const video of videos) {
          if (unitsToday >= UNITS_DAILY_CAP) break;
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
        if (newTotal > 0) log.push(`${newTotal} new YT comments for "${model.model}"`);
        processed++;
      }
    }

    res.status(200).json({ message: `Processed ${processed} model(s).`, search_calls_today: searchCallsToday, units_today: unitsToday, log });
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
