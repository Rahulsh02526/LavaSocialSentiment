// api/data.js
// GET /api/data
// Returns everything the frontend needs on load: models (joined with specs),
// comments (joined with tags), video_map, marketing_assets, fetch_progress summary.
// This intentionally returns a fairly large payload once per page load rather than
// many small calls, since this is a single-user internal tool, not a high-traffic app.

const { getSupabaseClient } = require('../lib/supabase');
const { requireViewer } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireViewer(req, res)) return;

  try {
    const supabase = getSupabaseClient();

    const [modelsRes, specsRes, commentsRes, tagsRes, videoMapRes, assetsRes, progressRes] = await Promise.all([
      supabase.from('models').select('*').order('model_id'),
      supabase.from('specs').select('*'),
      supabase.from('comments').select('*'),
      supabase.from('tags').select('*'),
      supabase.from('video_map').select('*'),
      supabase.from('marketing_assets').select('*'),
      supabase.from('fetch_progress').select('*'),
    ]);

    for (const [name, r] of [
      ['models', modelsRes], ['specs', specsRes], ['comments', commentsRes],
      ['tags', tagsRes], ['video_map', videoMapRes], ['marketing_assets', assetsRes],
      ['fetch_progress', progressRes],
    ]) {
      if (r.error) throw new Error(`${name} query failed: ${r.error.message}`);
    }

    // fold tags into comments by comment id, so the frontend gets the same
    // shape it expects (comment.tag = {...}) without a separate join step client-side
    const tagsByCommentId = {};
    tagsRes.data.forEach(t => { tagsByCommentId[t.comment_id] = t; });
    const comments = commentsRes.data.map(c => ({
      ...c,
      tag: tagsByCommentId[c.id] ? {
        sentiment: tagsByCommentId[c.id].sentiment,
        mentions: tagsByCommentId[c.id].mentions,
        narrative: tagsByCommentId[c.id].narrative,
        strategic_theme: tagsByCommentId[c.id].strategic_theme,
      } : null,
    }));

    // fold specs into a model_id-keyed map (matches the old STATE.specs shape)
    const specsByModelId = {};
    specsRes.data.forEach(s => { specsByModelId[s.model_id] = s; });

    // video_map and marketing_assets as model_id-keyed maps/arrays (matches old shape)
    const videoMap = {};
    videoMapRes.data.forEach(v => {
      videoMap[v.model_id] = {
        videoId: v.video_id, title: v.title, channel: v.channel,
        mappedAt: v.mapped_at, lastFetchedAt: v.last_fetched_at, newestCommentSeen: v.newest_comment_seen,
      };
    });

    const marketingAssets = {};
    assetsRes.data.forEach(a => {
      if (!marketingAssets[a.model_id]) marketingAssets[a.model_id] = [];
      marketingAssets[a.model_id].push({
        id: a.id, type: a.type, platform: a.platform, campaign_name: a.campaign_name,
        date: a.asset_date, url: a.url, tags: a.tags, notes: a.notes,
      });
    });

    res.status(200).json({
      phones: modelsRes.data,
      specs: specsByModelId,
      comments,
      videoMap,
      marketingAssets,
      fetchProgress: progressRes.data,
    });
  } catch (e) {
    console.error('GET /api/data failed:', e);
    res.status(500).json({ error: e.message });
  }
};
