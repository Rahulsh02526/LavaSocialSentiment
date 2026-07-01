// api/comments.js
// POST /api/comments  — add one or more manually-pasted comments (e-com refresh workflow)
// Body: { model_id, source, comment_date (optional), texts: ["line1", "line2", ...] }

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return 'h' + (h >>> 0).toString(36);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;

  const { model_id, source, comment_date, texts } = req.body || {};
  if (!model_id || !source || !Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'Body must include model_id, source, and a non-empty texts array.' });
  }
  if (!['Amazon', 'Flipkart', 'YouTube'].includes(source)) {
    return res.status(400).json({ error: 'source must be Amazon, Flipkart, or YouTube.' });
  }

  try {
    const supabase = getSupabaseClient();
    const rows = texts.filter(t => t && t.trim()).map(t => ({
      id: `${source}_${model_id}_${hashText(t.trim())}`,
      model_id, source, comment_text: t.trim(), comment_date: comment_date || null,
    }));

    const { data, error } = await supabase.from('comments').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select();
    if (error) throw new Error(error.message);

    res.status(200).json({ added: data.length, attempted: rows.length, comments: data });
  } catch (e) {
    console.error('POST /api/comments failed:', e);
    res.status(500).json({ error: e.message });
  }
};
