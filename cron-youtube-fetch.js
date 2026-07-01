// api/cron-youtube-fetch.js
// GET /api/cron-youtube-fetch  (triggered daily by Vercel Cron, see vercel.json)
// Also safe to call manually (e.g. a "Fetch Next Batch Now" button in the UI) —
// it always re-checks today's quota log before doing anything, so manual + cron
// calls on the same day correctly share the same daily budget.
//
// Logic per run:
//   1. Look at fetch_progress to find models that still need a video mapped (search.list)
//      or still need comments pulled (commentThreads.list).
//   2. Respect TWO separate budgets: search.list has its own 100-calls/day cap (Google-side),
//      and commentThreads.list draws from the shared 10,000-units/day pool. We track our own
//      usage in `quota_log` since Google does not return remaining quota in responses.
//   3. Process up to BATCH_SIZE models per run (default 12) — enough to cover all 58 models
//      in about 5 daily runs, comfortably within "10-15 models a day."
//   4. For models without a mapped video: search, pick the top result, save to video_map.
//   5. For models with a mapped video: pull new comments since last fetch (order=time,
//      stop once we hit a comment older than newest_comment_seen), insert into comments table.

const { getSupabaseClient } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');

const BATCH_SIZE = 12;
const SEARCH_DAILY_CAP = 90;     // leave headroom under Google's hard 100/day search.list cap
const UNITS_DAILY_CAP = 9000;    // leave headroom under the 10,000 shared pool

module.exports = async (req, res) => {
  // Two distinct trigger paths, each with its own auth:
  //   1. Vercel's own Cron scheduler — identified by user-agent, OR by the CRON_SECRET
  //      Vercel automatically sends as a Bearer token when CRON_SECRET is set as an env var
  //      (see https://vercel.com/docs/cron-jobs/manage-cron-jobs — this is Vercel's mechanism,
  //      separate from our app's own admin/viewer auth).
  //   2. A manual trigger from the UI — uses the same admin token as every other write action.
  const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0'
    || req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const isAdminTrigger = verifyToken(req.headers['x-auth-token'], 'admin');

  if (!isVercelCron && !isAdminTrigger) {
    return res.status(401).json({ error: 'Unauthorized. This endpoint can only be triggered by Vercel Cron or an authenticated admin.' });
  }

  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY.' });

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    // ---- check today's usage so far ----
    const { data: quotaRows, error: quotaErr } = await supabase
      .from('quota_log').select('call_type, units_used').eq('log_date', today);
    if (quotaErr) throw new Error(`Quota log read failed: ${quotaErr.message}`);

    let searchCallsToday = 0, unitsToday = 0;
    quotaRows.forEach(r => {
      unitsToday += r.units_used;
      if (r.call_type === 'search.list') searchCallsToday++;
    });

    const log = []; // human-readable summary returned in the response

    // ---- ensure fetch_progress has a row for every model ----
    const { data: models, error: modelsErr } = await supabase.from('models').select('model_id, model').order('model_id');
    if (modelsErr) throw new Error(`Models read failed: ${modelsErr.message}`);

    const { data: progressRows } = await supabase.from('fetch_progress').select('*');
    const progressByModel = {};
    (progressRows || []).forEach(p => { progressByModel[p.model_id] = p; });

    const missingProgress = models.filter(m => !progressByModel[m.model_id]);
    if (missingProgress.length) {
      await supabase.from('fetch_progress').insert(
        missingProgress.map(m => ({ model_id: m.model_id, status: 'pending' }))
      );
      missingProgress.forEach(m => { progressByModel[m.model_id] = { model_id: m.model_id, status: 'pending', search_completed: false }; });
    }

    // ---- pick this run's batch: prioritize never-searched models first, then never-fetched ----
    const needsSearch = models.filter(m => !progressByModel[m.model_id].search_completed && progressByModel[m.model_id].status !== 'no_video_found');
    const needsCommentsFetch = models.filter(m => progressByModel[m.model_id].search_completed && !progressByModel[m.model_id].comments_fetched_at);

    const batch = [...needsSearch, ...needsCommentsFetch].slice(0, BATCH_SIZE);

    if (batch.length === 0) {
      return res.status(200).json({ message: 'All models already have a video mapped and comments fetched. Nothing to do.', log });
    }

    let processed = 0;
    for (const model of batch) {
      const progress = progressByModel[model.model_id];

      // ---------- SEARCH (find + map a video) ----------
      if (!progress.search_completed) {
        if (searchCallsToday >= SEARCH_DAILY_CAP) {
          log.push(`Stopped: hit daily search.list cap (${SEARCH_DAILY_CAP}) before mapping "${model.model}".`);
          break;
        }
        const query = encodeURIComponent(`${model.model} review`);
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=5&relevanceLanguage=en&order=relevance&key=${ytKey}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        searchCallsToday++;
        await supabase.from('quota_log').insert({ log_date: today, units_used: 100, call_type: 'search.list', model_id: model.model_id });
        unitsToday += 100;

        if (searchData.error) {
          await supabase.from('fetch_progress').update({ status: 'error', error_message: searchData.error.message, updated_at: new Date().toISOString() }).eq('model_id', model.model_id);
          log.push(`Search failed for "${model.model}": ${searchData.error.message}`);
          continue;
        }

        const items = searchData.items || [];
        if (items.length === 0) {
          await supabase.from('fetch_progress').update({ status: 'no_video_found', search_completed: true, search_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('model_id', model.model_id);
          log.push(`No video found for "${model.model}".`);
          continue;
        }

        const top = items[0];
        await supabase.from('video_map').upsert({
          model_id: model.model_id, video_id: top.id.videoId, title: top.snippet.title,
          channel: top.snippet.channelTitle, mapped_at: new Date().toISOString(),
        }, { onConflict: 'model_id' });

        await supabase.from('fetch_progress').update({
          status: 'searched', search_completed: true, search_completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('model_id', model.model_id);

        log.push(`Mapped "${model.model}" → "${top.snippet.title}" (${top.snippet.channelTitle}).`);
        processed++;
        progress.search_completed = true; // so the comments-fetch step below can run in the same pass if budget allows
      }

      // ---------- FETCH COMMENTS (for newly or previously mapped videos) ----------
      if (unitsToday >= UNITS_DAILY_CAP) {
        log.push(`Stopped: approaching daily unit cap (${UNITS_DAILY_CAP}) before fetching comments for "${model.model}".`);
        break;
      }

      const { data: videoMapRow } = await supabase.from('video_map').select('*').eq('model_id', model.model_id).single();
      if (!videoMapRow) continue; // no_video_found case from above

      const commentsUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoMapRow.video_id}&maxResults=100&order=time&textFormat=plainText&key=${ytKey}`;
      const commentsRes = await fetch(commentsUrl);
      const commentsData = await commentsRes.json();
      await supabase.from('quota_log').insert({ log_date: today, units_used: 1, call_type: 'commentThreads.list', model_id: model.model_id });
      unitsToday += 1;

      if (commentsData.error) {
        const reason = commentsData.error.errors?.[0]?.reason;
        await supabase.from('fetch_progress').update({ status: 'error', error_message: commentsData.error.message, updated_at: new Date().toISOString() }).eq('model_id', model.model_id);
        log.push(`Comment fetch failed for "${model.model}": ${commentsData.error.message}${reason === 'commentsDisabled' ? ' (comments disabled on this video)' : ''}`);
        continue;
      }

      const items = commentsData.items || [];
      const newestSeen = videoMapRow.newest_comment_seen ? new Date(videoMapRow.newest_comment_seen) : null;
      let newestInBatch = newestSeen;
      const rowsToInsert = [];

      for (const item of items) {
        const publishedAt = item.snippet.topLevelComment.snippet.publishedAt;
        const commentTime = new Date(publishedAt);
        if (newestSeen && commentTime <= newestSeen) continue; // already fetched in a prior run
        if (!newestInBatch || commentTime > newestInBatch) newestInBatch = commentTime;

        const text = item.snippet.topLevelComment.snippet.textDisplay;
        rowsToInsert.push({
          id: `YouTube_${model.model_id}_${hashText(text)}`,
          model_id: model.model_id, source: 'YouTube', comment_text: text,
          comment_date: publishedAt.slice(0, 10),
        });
      }

      if (rowsToInsert.length) {
        await supabase.from('comments').upsert(rowsToInsert, { onConflict: 'id', ignoreDuplicates: true });
      }

      await supabase.from('video_map').update({
        last_fetched_at: new Date().toISOString(),
        newest_comment_seen: newestInBatch ? newestInBatch.toISOString() : videoMapRow.newest_comment_seen,
      }).eq('model_id', model.model_id);

      await supabase.from('fetch_progress').update({
        status: 'fetched', comments_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('model_id', model.model_id);

      log.push(`Fetched comments for "${model.model}": ${items.length} returned, ${rowsToInsert.length} new.`);
      processed++;
    }

    res.status(200).json({
      message: `Processed ${processed} model(s) this run.`,
      search_calls_used_today: searchCallsToday,
      units_used_today: unitsToday,
      log,
    });
  } catch (e) {
    console.error('GET /api/cron-youtube-fetch failed:', e);
    res.status(500).json({ error: e.message });
  }
};

// must match the frontend's hashText exactly so comment ids stay consistent
function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(36);
}
