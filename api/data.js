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

    const [modelsRes, specsRes, videoMapRes, assetsRes, progressRes] = await Promise.all([
      supabase.from('models').select('*').order('model_id'),
      supabase.from('specs').select('*'),
      supabase.from('model_videos').select('*'),   // new multi-video table
      supabase.from('marketing_assets').select('*'),
      supabase.from('fetch_progress').select('*'),
    ]);

    // comments and tags can exceed 1000 rows — fetch in pages of 1000
    async function fetchAll(table, select = '*') {
      let rows = [], from = 0, pageSize = 1000;
      while (true) {
        const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1);
        if (error) throw new Error(`${table} query failed: ${error.message}`);
        rows = rows.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      return rows;
    }

    const [commentsData, tagsData] = await Promise.all([
      fetchAll('comments'),
      fetchAll('tags'),
    ]);
    const commentsRes = { data: commentsData, error: null };
    const tagsRes = { data: tagsData, error: null };

    for (const [name, r] of [
      ['models', modelsRes], ['specs', specsRes],
      ['video_map', videoMapRes], ['marketing_assets', assetsRes],
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

    // fold model_videos into model_id-keyed array (multiple videos per model now)
    const videoMap = {};
    (videoMapRes.data || []).forEach(v => {
      if (!videoMap[v.model_id]) videoMap[v.model_id] = [];
      videoMap[v.model_id].push({
        id: v.id, videoId: v.video_id, videoType: v.video_type,
        title: v.title, channel: v.channel,
        mappedAt: v.mapped_at, lastFetchedAt: v.last_fetched_at, newestCommentSeen: v.newest_comment_seen,
      });
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
