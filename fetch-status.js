// api/fetch-status.js
// GET /api/fetch-status
// Returns a summary of YouTube fetch progress across all models, plus today's quota usage,
// so the frontend can show "38/58 models covered, next batch runs with tomorrow's cron" etc.

const { getSupabaseClient } = require('../lib/supabase');
const { requireViewer } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireViewer(req, res)) return;

  try {
    const supabase = getSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    const [{ data: progress, error: progErr }, { data: quota, error: quotaErr }] = await Promise.all([
      supabase.from('fetch_progress').select('*'),
      supabase.from('quota_log').select('call_type, units_used').eq('log_date', today),
    ]);
    if (progErr) throw new Error(progErr.message);
    if (quotaErr) throw new Error(quotaErr.message);

    const counts = { pending: 0, searched: 0, fetched: 0, no_video_found: 0, error: 0 };
    (progress || []).forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

    let searchCallsToday = 0, unitsToday = 0;
    (quota || []).forEach(r => {
      unitsToday += r.units_used;
      if (r.call_type === 'search.list') searchCallsToday++;
    });

    res.status(200).json({
      total_models: progress.length,
      status_counts: counts,
      fully_covered: counts.fetched,
      today: {
        search_calls_used: searchCallsToday,
        search_calls_cap: 90,
        units_used: unitsToday,
        units_cap: 9000,
      },
    });
  } catch (e) {
    console.error('GET /api/fetch-status failed:', e);
    res.status(500).json({ error: e.message });
  }
};
