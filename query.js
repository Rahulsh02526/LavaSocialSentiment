// api/query.js
// POST /api/query
// Body: { text: "free text question" }
// Step 1: ask Claude to parse the question into structured filters + focus parameter.
// Step 2: fetch matching models (specs + sentiment + marketing assets) from Supabase.
// Step 3: ask Claude to synthesize a positioning/competitive analysis.
// Returns { filters, focusParameter, matchedModels, answer } in one response.

const { getSupabaseClient } = require('../lib/supabase');
const { requireViewer } = require('../lib/auth');

const PARAMS = ['battery','camera_back','camera_front','display','performance','processor','storage','memory','looks','heating','sound','software','value','charging','wifi','nfc','overall'];
const PARAM_LABELS = {
  battery:'Battery', camera_back:'Rear Camera', camera_front:'Front Camera', display:'Display',
  performance:'Performance', processor:'Processor', storage:'Storage', memory:'RAM/Memory',
  looks:'Looks/Design', heating:'Heating', sound:'Sound', software:'Software', value:'Value for Money',
  charging:'Charging Speed', wifi:'WiFi', nfc:'NFC', overall:'Overall',
};

async function callClaude(apiKey, { system, messages, max_tokens }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: max_tokens || 1000, system, messages }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Claude API returned ${r.status}`);
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text content in Claude response');
  return textBlock.text;
}

function isWithinSentimentWindow(model, commentDate) {
  if (!commentDate || !model.sentiment_frozen_at) return true;
  return new Date(commentDate) <= new Date(model.sentiment_frozen_at);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireViewer(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY.' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Body must include "text".' });

  try {
    const supabase = getSupabaseClient();

    // ---- Step 1: parse intent ----
    const parsePrompt = `You parse smartphone-market questions into JSON filters. Given the question, output ONLY a JSON object with these optional keys: minPrice (number, INR), maxPrice (number, INR), segment (one of "budget"<10000, "entry_mid" 10000-15000, "mid" 15000-20000, "upper_mid" 20000-25000, "premium_mid" 25000-30000, or "all"), network ("5g"|"4g"|"all"), brand (string or "all"), focusParameter (one of ${PARAMS.join(', ')} — or null if the question doesn't name a specific product aspect to position around). If a range is mentioned like "10-15k" treat as 10000-15000 and set segment to "entry_mid". No prose, just JSON.

Question: "${text}"`;

    const parseRaw = await callClaude(apiKey, { messages: [{ role: 'user', content: parsePrompt }], max_tokens: 300 });
    let parsed = {};
    try {
      parsed = JSON.parse(parseRaw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, ''));
    } catch (e) { parsed = {}; }

    const filters = {
      minPrice: parsed.minPrice || null,
      maxPrice: parsed.maxPrice || null,
      segment: parsed.segment || 'all',
      network: parsed.network || 'all',
      brand: parsed.brand || 'all',
    };
    const focusParameter = parsed.focusParameter && PARAMS.includes(parsed.focusParameter) ? parsed.focusParameter : null;

    // ---- Step 2: fetch matching models from Supabase ----
    let query = supabase.from('models').select('*, specs(*)');
    if (filters.minPrice) query = query.gte('launch_price_inr', filters.minPrice);
    if (filters.maxPrice) query = query.lte('launch_price_inr', filters.maxPrice);
    if (filters.segment !== 'all') query = query.eq('price_segment', filters.segment);
    if (filters.brand !== 'all') query = query.ilike('brand', filters.brand);

    const { data: models, error: modelsErr } = await query;
    if (modelsErr) throw new Error(`Model query failed: ${modelsErr.message}`);

    let matched = models;
    if (filters.network !== 'all') {
      matched = matched.filter(m => {
        const conn = m.specs?.connectivity || '';
        const isFiveG = conn && !conn.includes('4G only');
        return filters.network === '5g' ? isFiveG : !isFiveG;
      });
    }
    matched = matched.slice(0, 20);

    if (matched.length === 0) {
      return res.status(200).json({ filters, focusParameter, matchedModels: [], answer: 'No models matched those filters. Try widening the price range or network filter.' });
    }

    const modelIds = matched.map(m => m.model_id);

    // pull tagged comments + assets for matched models in two queries
    const { data: comments, error: commentsErr } = await supabase
      .from('comments').select('*, tags(*)').in('model_id', modelIds);
    if (commentsErr) throw new Error(`Comments query failed: ${commentsErr.message}`);

    const { data: assets, error: assetsErr } = await supabase
      .from('marketing_assets').select('*').in('model_id', modelIds);
    if (assetsErr) throw new Error(`Assets query failed: ${assetsErr.message}`);

    // ---- build per-model summaries ----
    const summaries = matched.map(m => {
      const modelComments = comments.filter(c => c.model_id === m.model_id && c.tags && isWithinSentimentWindow(m, c.comment_date));
      const sentCounts = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
      const paramMentions = {};
      const themeCounts = {};
      const narratives = [];
      modelComments.forEach(c => {
        const t = c.tags;
        const s = (t.sentiment || 'neutral').toLowerCase();
        if (sentCounts[s] !== undefined) sentCounts[s]++;
        if (t.strategic_theme) themeCounts[t.strategic_theme] = (themeCounts[t.strategic_theme] || 0) + 1;
        if (t.narrative) narratives.push(t.narrative);
        (t.mentions || []).forEach(mn => {
          if (!paramMentions[mn.parameter]) paramMentions[mn.parameter] = { pos: 0, neg: 0, mixed: 0 };
          if (mn.sentiment === 'positive') paramMentions[mn.parameter].pos++;
          else if (mn.sentiment === 'negative') paramMentions[mn.parameter].neg++;
          else paramMentions[mn.parameter].mixed++;
        });
      });
      const modelAssets = assets.filter(a => a.model_id === m.model_id)
        .map(a => ({ type: a.type, platform: a.platform, campaign_name: a.campaign_name, tags: a.tags }));

      return {
        model: m.model, brand: m.brand, brand_tier: m.brand_tier,
        launch_price_inr: m.launch_price_inr, price_segment: m.price_segment, launch_date: m.launch_date,
        processor: m.specs?.processor, ram: m.specs?.ram_variants, storage: m.specs?.storage_variants,
        display: m.specs?.display, battery_mah: m.specs?.battery_mah, fast_charging_w: m.specs?.fast_charging_w,
        rear_camera: m.specs?.rear_camera, front_camera: m.specs?.front_camera, os: m.specs?.os,
        connectivity: m.specs?.connectivity,
        network: (m.specs?.connectivity && !m.specs.connectivity.includes('4G only')) ? '5G' : '4G only',
        amazon_rating: m.amazon_rating, flipkart_rating: m.flipkart_rating,
        tagged_comment_count: modelComments.length,
        sentiment_breakdown: sentCounts, strategic_themes: themeCounts,
        parameter_sentiment: paramMentions,
        sample_narratives: [...new Set(narratives)].slice(0, 5),
        marketing_assets: modelAssets,
      };
    });

    // ---- Step 3: synthesize ----
    const synthPrompt = focusParameter ? `You are a competitive intelligence analyst for LAVA International, a smartphone brand. A marketing team member asked: "${text}"

They are specifically interested in positioning around: ${PARAM_LABELS[focusParameter]}.

Here is structured data (specs + sentiment + marketing assets) for the matching competitor models:
${JSON.stringify(summaries, null, 1)}

Write a concise positioning analysis (under 350 words) covering, in this order:
1. What EVERY competitor in this set is currently doing/claiming on ${PARAM_LABELS[focusParameter]} — sentiment, specs, and any narratives tied to it. Name models specifically.
2. How CLUTTERED or UNCLUTTERED this parameter currently is in this price band — is every competitor already making a ${PARAM_LABELS[focusParameter]} claim (crowded, hard to differentiate), or is it under-claimed / inconsistently delivered (genuine whitespace for LAVA)? Be direct about which it is.
3. Which models (if any) have marketing assets tagged to this parameter already, so the user knows what messaging is already out there.
No markdown headers, just clear prose paragraphs.` : `You are a competitive intelligence analyst for LAVA International, a smartphone brand. The user asked: "${text}"

Here is structured data (specs + sentiment + marketing assets) for the matching competitor models:
${JSON.stringify(summaries, null, 1)}

Write a concise competitive analysis (under 300 words) covering: (1) the competitive landscape at this price/network band, (2) which models stand out on specs vs sentiment, (3) any whitespace or gaps LAVA could target. Be specific and reference model names. No markdown headers, just clear prose paragraphs.`;

    const answer = await callClaude(apiKey, { messages: [{ role: 'user', content: synthPrompt }], max_tokens: 1000 });

    res.status(200).json({ filters, focusParameter, matchedModels: summaries, answer });
  } catch (e) {
    console.error('POST /api/query failed:', e);
    res.status(500).json({ error: e.message });
  }
};
