// api/videos.js
// Merged: search-videos + save-video-selection + replace-video + cron-youtube-fetch
// POST /api/videos?action=search     — fetch 20 candidates with thumbnails/views
// POST /api/videos?action=save       — save admin's manual selection
// POST /api/videos?action=replace    — replace video + clear old YT comments
// GET  /api/videos?action=cron       — daily cron: search + fetch comments for one model
//                                      (replaces the old cron-youtube-fetch.js)

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin, verifyToken } = require('../lib/auth');

const REGION = 'IN';
const MAX_REVIEWER_VIDEOS = 10;

// Geography signals used by BOTH manual search and cron fetch
// Hard reject non-India geography only — NOT language signals
// India has Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali (Indian) reviewers — all valid
const NON_INDIA_SIGNALS = [
  'bangladesh','price in bd','bd price','taka','৳','dhaka','in bangladesh',
  'indonesia','harga','rupiah','jakarta','philippines','pilipinas','piso','manila',
  'pakistan','pkr','karachi','lahore','nepal','sri lanka','myanmar','malaysia',
  'nigeria','ghana','kenya','ethiopia',
];

// Positive India signals — used only for scoring, not hard filter
const INDIA_SIGNALS = ['india', '₹', 'rs.', 'rupees', 'indian'];

function isNonIndia(item) {
  const s = ((item.snippet?.title||'')+(item.snippet?.channelTitle||'')).toLowerCase();
  return NON_INDIA_SIGNALS.some(sig => s.includes(sig)) || s.includes('#shorts') || s.includes('#short');
}

// Score video for ranking in cron runs — higher = more India-relevant
function scoreVideo(item) {
  const title = (item.snippet.title || '').toLowerCase();
  const channel = (item.snippet.channelTitle || '').toLowerCase();
  const combined = title + ' ' + channel;

  if (title.includes('#shorts') || title.includes('#short') || title.includes('#ytshorts')) return -1;
  for (const sig of NON_INDIA_SIGNALS) {
    if (combined.includes(sig)) return -1;
  }

  let score = 0;
  for (const sig of INDIA_SIGNALS) {
    if (combined.includes(sig)) score += 2;
  }
  const REVIEW_SIGNALS = ['review', 'unboxing', 'first look', 'hands on', 'hands-on', 'camera test', 'gaming test', 'vs ', 'comparison'];
  for (const sig of REVIEW_SIGNALS) {
    if (title.includes(sig)) { score += 1; break; }
  }
  return score;
}

function filterAndRankVideos(items) {
  return items
    .map(item => ({ item, score: scoreVideo(item) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

// Simple hash for comment deduplication
function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(36);
}

module.exports = async (req, res) => {
  const action = req.query.action || 'search';

  // ── CRON action: allow GET from Vercel cron or admin token ──
  if (action === 'cron') {
    const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0'
      || req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
    const isAdminTrigger = verifyToken(req.headers['x-auth-token'], 'admin');
    if (!isVercelCron && !isAdminTrigger) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    return handleCronFetch(req, res);
  }

  // All other actions: POST + admin only
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const action2 = action; // already set above
  const supabase = getSupabaseClient();
  const ytKey = process.env.YOUTUBE_API_KEY;

  try {
    // ── SEARCH ──
    if (action2 === 'search') {
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
    if (action2 === 'save') {
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
    if (action2 === 'replace') {
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

    return res.status(400).json({ error: `Unknown action: ${action2}` });
  } catch (e) {
    console.error('videos.js failed:', e);
    return res.status(500).json({ error: e.message });
  }
};

// ── CRON FETCH: Daily job — search videos + fetch comments for one model ──
// Extracted from the old cron-youtube-fetch.js and merged here.
// One invocation = one model (stays within 60s Vercel timeout).
async function handleCronFetch(req, res) {
  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY.' });

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    // ── Check today's quota usage ──
    const { data: quotaRows } = await supabase.from('quota_log').select('call_type, units_used').eq('log_date', today);
    let searchCallsToday = 0, unitsToday = 0;
    (quotaRows || []).forEach(r => {
      unitsToday += r.units_used;
      if (r.call_type === 'search.list') searchCallsToday++;
    });

    if (searchCallsToday >= 90) return res.status(200).json({ message: 'Search quota reached for today.', searchCallsToday, unitsToday });
    if (unitsToday >= 9000) return res.status(200).json({ message: 'Unit quota reached for today.', unitsToday });

    // ── Load models, progress, marketing assets ──
    const { data: models } = await supabase.from('models').select('model_id, model, brand, launch_date').order('model_id');
    const { data: progressRows } = await supabase.from('fetch_progress').select('*');
    const progress = {};
    (progressRows || []).forEach(p => { progress[p.model_id] = p; });

    // Official YouTube URLs from marketing_assets — avoids using search quota
    const { data: assetRows } = await supabase.from('marketing_assets')
      .select('model_id, type, platform, url')
      .eq('platform', 'YouTube');
    const officialYTMap = {};
    (assetRows || []).forEach(a => {
      if (a.url && a.url.includes('youtube.com') && !officialYTMap[a.model_id]) {
        officialYTMap[a.model_id] = a.url;
      }
    });

    // ── Ensure all models have a fetch_progress row ──
    const missing = models.filter(m => !progress[m.model_id]);
    if (missing.length) {
      await supabase.from('fetch_progress').insert(
        missing.map(m => ({ model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false }))
      );
      missing.forEach(m => {
        progress[m.model_id] = { model_id: m.model_id, status: 'pending', official_search_done: false, reviewer_search_done: false };
      });
    }

    const log = [];

    // ── Sort: models needing search first, then oldest comment fetch ──
    const sortedModels = [...models].sort((a, b) => {
      const pa = progress[a.model_id] || {};
      const pb = progress[b.model_id] || {};
      const aNeedsSearch = !pa.official_search_done || !pa.reviewer_search_done;
      const bNeedsSearch = !pb.official_search_done || !pb.reviewer_search_done;
      if (aNeedsSearch && !bNeedsSearch) return -1;
      if (!aNeedsSearch && bNeedsSearch) return 1;
      const aLast = pa.comments_fetched_at ? new Date(pa.comments_fetched_at).getTime() : 0;
      const bLast = pb.comments_fetched_at ? new Date(pb.comments_fetched_at).getTime() : 0;
      return aLast - bLast;
    });

    // ── Process one model per cron invocation (keeps within 60s timeout) ──
    for (const model of sortedModels) {
      const p = progress[model.model_id] || {};
      const needsSearch = !p.official_search_done || !p.reviewer_search_done;
      const lastFetch = p.comments_fetched_at ? new Date(p.comments_fetched_at) : null;
      const hoursSinceFetch = lastFetch ? (Date.now() - lastFetch.getTime()) / 3600000 : 999;
      const needsComments = p.official_search_done && p.reviewer_search_done && hoursSinceFetch >= 20;

      if (!needsSearch && !needsComments) continue;

      // publishedAfter: launch_date minus 3 days (captures pre-launch hype)
      const publishedAfter = model.launch_date
        ? new Date(new Date(model.launch_date).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
        : new Date('2025-01-01').toISOString();

      // ── Official video search ──
      if (!p.official_search_done && searchCallsToday < 90) {
        const assetYTUrl = officialYTMap[model.model_id];
        if (assetYTUrl) {
          // Use marketing asset URL — no search quota used
          const videoIdMatch = assetYTUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          const videoId = videoIdMatch?.[1];
          if (videoId) {
            const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${ytKey}`);
            const vd = await vr.json();
            unitsToday += 1;
            await supabase.from('quota_log').insert({ log_date: today, units_used: 1, call_type: 'videos.list', model_id: model.model_id });
            const vItem = vd.items?.[0];
            await supabase.from('model_videos').upsert({
              model_id: model.model_id, video_id: videoId, video_type: 'official',
              title: vItem?.snippet?.title || assetYTUrl,
              channel: vItem?.snippet?.channelTitle || null,
              channel_id: vItem?.snippet?.channelId || null,
              published_at: vItem?.snippet?.publishedAt || null,
              mapped_at: new Date().toISOString(),
            }, { onConflict: 'model_id,video_id' });
            log.push(`Official: "${model.model}" → from marketing assets → "${vItem?.snippet?.title || videoId}"`);
            await supabase.from('fetch_progress').upsert(
              { model_id: model.model_id, official_search_done: true, updated_at: new Date().toISOString() },
              { onConflict: 'model_id' }
            );
            p.official_search_done = true;
          }
        }

        if (!p.official_search_done) {
          // Fallback: YouTube search (costs 100 units)
          const query = encodeURIComponent(`"${model.model}" official launch`);
          const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=10&regionCode=${REGION}&relevanceLanguage=en&order=relevance&publishedAfter=${publishedAfter}&key=${ytKey}`;
          const r = await fetch(url);
          const data = await r.json();
          searchCallsToday++; unitsToday += 100;
          await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });

          if (!data.error && data.items?.length) {
            const filtered = filterAndRankVideos(data.items);
            if (filtered.length) {
              const brand = (model.brand || '').toLowerCase();
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
              log.push(`Official: "${model.model}" → YT search → "${top.snippet.title}"`);
            } else {
              log.push(`Official: "${model.model}" — all results filtered as non-India`);
            }
          } else {
            log.push(`Official: "${model.model}" — no results`);
          }
          await supabase.from('fetch_progress').upsert(
            { model_id: model.model_id, official_search_done: true, updated_at: new Date().toISOString() },
            { onConflict: 'model_id' }
          );
          p.official_search_done = true;
        }
      }

      // ── Reviewer videos search ──
      if (!p.reviewer_search_done && searchCallsToday < 90) {
        const query = encodeURIComponent(`"${model.model}" review`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=20&regionCode=${REGION}&relevanceLanguage=en&order=relevance&publishedAfter=${publishedAfter}&key=${ytKey}`;
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
            log.push(`Reviewer: "${model.model}" — all ${data.items.length} results filtered`);
          }
        } else {
          log.push(`Reviewer: "${model.model}" — no results`);
        }
        await supabase.from('fetch_progress').upsert(
          { model_id: model.model_id, reviewer_search_done: true, status: 'searched', updated_at: new Date().toISOString() },
          { onConflict: 'model_id' }
        );
        p.reviewer_search_done = true;
      }

      // ── Fetch comments for this model (after both searches done) ──
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

      // One model per run — return here
      return res.status(200).json({
        message: `Processed "${model.model}"`,
        search_calls_today: searchCallsToday,
        units_today: unitsToday,
        log,
      });
    }

    return res.status(200).json({ message: 'All models up to date.', units_today: unitsToday, log });
  } catch (e) {
    console.error('cron-youtube-fetch failed:', e);
    return res.status(500).json({ error: e.message });
  }
}
