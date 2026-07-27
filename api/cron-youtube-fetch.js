// api/cron-youtube-fetch.js
// One run = one model, does ALL operations for that model (search + comment fetch)
// to avoid needing multiple manual triggers.
// Post-filters search results to reject Bangladesh/Indonesia/Philippines content.

const { getSupabaseClient } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');

const MAX_REVIEWER_VIDEOS = 10;
const REGION = 'IN';

// Hard reject — geography signals only, NOT language signals
// India has Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali (Indian) reviewers — all valid
const NON_INDIA_SIGNALS = [
  // Bangladesh
  'bangladesh', 'price in bd', 'bd price', 'taka', '৳', 'dhaka',
  'unboxing bd', 'review bd', 'bd unboxing', 'in bangladesh',
  // Indonesia
  'indonesia', 'harga', 'rupiah', 'rp.', 'jakarta',
  // Philippines
  'philippines', 'pilipinas', 'piso', 'manila', 'presyo',
  // Pakistan
  'pakistan', 'pkr', 'karachi', 'lahore', 'in pakistan',
  // Other non-India markets
  'nepal', 'sri lanka', 'myanmar', 'malaysia', 'vietnam',
  'nigeria', 'ghana', 'kenya', 'ethiopia',
  // Generic non-India price signals
  'price in bd', 'bd tech', 'bd review',
];

// Positive India signals — prefer these but absence is NOT a reject
const INDIA_SIGNALS = [
  'india', '₹', 'rs.', 'rupees', 'indian',
  // regional Indian languages are fine — NOT included as filters
];

// Note: "hindi", "tamil", "telugu", "kannada", "malayalam", "marathi",
// "bengali" are NOT reject signals — these are valid Indian language reviewers

function scoreVideo(item) {
  const title = (item.snippet.title || '').toLowerCase();
  const channel = (item.snippet.channelTitle || '').toLowerCase();
  const combined = title + ' ' + channel;

  // hard reject non-India signals
  for (const sig of NON_INDIA_SIGNALS) {
    if (combined.includes(sig)) return -1; // reject
  }

  // score India signals positively
  let score = 0;
  for (const sig of INDIA_SIGNALS) {
    if (combined.includes(sig)) score += 2;
  }
  return score;
}

function filterAndRankVideos(items) {
  return items
    .map(item => ({ item, score: scoreVideo(item) }))
    .filter(({ score }) => score >= 0) // remove hard rejects
    .sort((a, b) => b.score - a.score) // prefer India-confirmed content
    .map(({ item }) => item);
}

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

    if (searchCallsToday >= 90) return res.status(200).json({ message: 'Search quota reached for today.', searchCallsToday, unitsToday });
    if (unitsToday >= 9000) return res.status(200).json({ message: 'Unit quota reached for today.', unitsToday });

    // fetch models with launch_date for publishedAfter filter
    const { data: models } = await supabase.from('models').select('model_id, model, brand, launch_date').order('model_id');
    const { data: progressRows } = await supabase.from('fetch_progress').select('*');
    const progress = {};
    (progressRows || []).forEach(p => { progress[p.model_id] = p; });

    // ensure all models have a progress row
    const missing = models.filter(m => !progress[m.model_id]);
    if (missing.length) {
      await supabase.from('fetch_progress').insert(missing.map(m => ({
        model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false
      })));
      missing.forEach(m => { progress[m.model_id] = { model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false }; });
    }

    const log = [];

    // find first model that needs any work and do ALL its pending operations
    for (const model of models) {
      const p = progress[model.model_id] || {};
      const needsSearch = !p.official_search_done || !p.reviewer_search_done;
      const lastFetch = p.comments_fetched_at ? new Date(p.comments_fetched_at) : null;
      const hoursSinceFetch = lastFetch ? (Date.now() - lastFetch.getTime()) / 3600000 : 999;
      const needsComments = p.official_search_done && p.reviewer_search_done && hoursSinceFetch >= 20;

      if (!needsSearch && !needsComments) continue;

      // publishedAfter = launch_date - 3 days (captures pre-launch hype)
      const publishedAfter = model.launch_date
        ? new Date(new Date(model.launch_date).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
        : new Date('2025-01-01').toISOString();

      // ---- OFFICIAL VIDEO SEARCH ----
      if (!p.official_search_done && searchCallsToday < 90) {
        const query = encodeURIComponent(`"${model.model}" official launch`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=10&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&videoDuration=medium&publishedAfter=${publishedAfter}&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        searchCallsToday++; unitsToday += 100;
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

        if (!data.error && data.items?.length) {
          const filtered = filterAndRankVideos(data.items);
          if (filtered.length) {
            const brand = (model.brand || '').toLowerCase();
            // prefer channel containing brand name for official
            const sorted = filtered.sort((a, b) => {
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
            log.push(`Official: "${model.model}" — all results filtered as non-India`);
          }
        } else {
          log.push(`Official: "${model.model}" — no results`);
        }
        await supabase.from('fetch_progress').upsert({
          model_id: model.model_id, official_search_done: true, updated_at: new Date().toISOString()
        }, { onConflict: 'model_id' });
        p.official_search_done = true;
      }

      // ---- REVIEWER VIDEOS SEARCH ----
      if (!p.reviewer_search_done && searchCallsToday < 90) {
        const query = encodeURIComponent(`"${model.model}" review`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=20&regionCode=${REGION}&relevanceLanguage=en&order=viewCount&videoDuration=medium&publishedAfter=${publishedAfter}&key=${ytKey}`;
        const r = await fetch(url);
        const data = await r.json();
        searchCallsToday++; unitsToday += 100;
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

        if (!data.error && data.items?.length) {
          const filtered = filterAndRankVideos(data.items);
          const top10 = filtered.slice(0, MAX_REVIEWER_VIDEOS);
          if (top10.length) {
            const rows = top10.map(item => ({
              model_id: model.model_id, video_id: item.id.videoId, video_type: 'reviewer',
              title: item.snippet.title, channel: item.snippet.channelTitle,
              channel_id: item.snippet.channelId, published_at: item.snippet.publishedAt,
              mapped_at: new Date().toISOString(),
            }));
            await supabase.from('model_videos').upsert(rows, { onConflict: 'model_id,video_id' });
            log.push(`Reviewer: ${top10.length} India-filtered videos for "${model.model}" (rejected ${data.items.length - filtered.length} non-India)`);
          } else {
            log.push(`Reviewer: "${model.model}" — all ${data.items.length} results filtered as non-India`);
          }
        } else {
          log.push(`Reviewer: "${model.model}" — no results`);
        }
        await supabase.from('fetch_progress').upsert({
          model_id: model.model_id, reviewer_search_done: true, status: 'searched', updated_at: new Date().toISOString()
        }, { onConflict: 'model_id' });
        p.reviewer_search_done = true;
      }

      // ---- FETCH COMMENTS (same run, after searches) ----
      if (p.official_search_done && p.reviewer_search_done && unitsToday < 9000) {
        const { data: videos } = await supabase.from('model_videos').select('*').eq('model_id', model.model_id);
        if (videos?.length) {
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
              rows.push({
                id: `YouTube_${model.model_id}_${hashText(text)}`,
                model_id: model.model_id, source: 'YouTube',
                comment_text: text, comment_date: publishedAt.slice(0, 10),
              });
            }
            if (rows.length) {
              await supabase.from('comments').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
              newTotal += rows.length;
            }
            await supabase.from('model_videos').update({
              last_fetched_at: new Date().toISOString(),
              newest_comment_seen: newestInBatch ? newestInBatch.toISOString() : video.newest_comment_seen,
            }).eq('id', video.id);
          }
          await supabase.from('fetch_progress').upsert({
            model_id: model.model_id, status: 'fetched',
            comments_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }, { onConflict: 'model_id' });
          log.push(`Comments: ${newTotal} new YT comments for "${model.model}"`);
        }
      }

      // done with this model — return result
      return res.status(200).json({
        message: `Processed "${model.model}"`,
        search_calls_today: searchCallsToday,
        units_today: unitsToday,
        log,
      });
    }

    return res.status(200).json({ message: 'All models up to date.', unitsToday, log });
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
