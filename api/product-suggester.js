// api/product-suggester.js
// POST /api/product-suggester
// Body: { target_price, proposed_specs, platform_focus }
// Returns: market snapshot, consumer buzz, verdict, recommendation
// Uses existing comments/tags/specs data + Claude synthesis

const { getSupabaseClient } = require('../lib/supabase');
const { verifyToken } = require('../lib/auth');


const PARAMS = ['battery','camera_back','camera_front','display','performance',
  'processor','storage','memory','looks','heating','sound','software',
  'value','charging','wifi','nfc','overall'];

const PARAM_LABELS = {
  battery:'Battery', camera_back:'Rear Camera', camera_front:'Front Camera',
  display:'Display', performance:'Performance', processor:'Processor',
  storage:'Storage', memory:'RAM/Memory', looks:'Design/Looks',
  heating:'Heating', sound:'Audio', software:'Software/UI',
  value:'Value for Money', charging:'Charging Speed', wifi:'WiFi/Connectivity',
  nfc:'NFC', overall:'Overall',
};

function deriveSegment(price) {
  if (price < 10000) return 'budget';
  if (price < 15000) return 'entry_mid';
  if (price < 20000) return 'mid';
  if (price < 25000) return 'upper_mid';
  return 'premium_mid';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-auth-token'];
  if (!verifyToken(token, 'viewer') && !verifyToken(token, 'admin')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const { target_price, proposed_specs, platform_focus } = req.body || {};
  if (!target_price) return res.status(400).json({ error: 'target_price is required.' });

  const price = parseFloat(target_price);
  const segment = deriveSegment(price);

  // price band: ±15% of target price for competition
  const priceLow  = price * 0.82;
  const priceHigh = price * 1.18;

  try {
    const supabase = getSupabaseClient();

    // ── 1. Get competitor models in price band ──
    const { data: competitors } = await supabase
      .from('models')
      .select('model_id, model, brand, launch_price_inr, current_price_inr, price_segment')
      .gte('launch_price_inr', priceLow)
      .lte('launch_price_inr', priceHigh)
      .order('launch_price_inr');

    if (!competitors?.length) {
      return res.status(200).json({
        segment, competitors: [], buzz: [], verdict: null,
        message: `No models found between ₹${Math.round(priceLow).toLocaleString('en-IN')} and ₹${Math.round(priceHigh).toLocaleString('en-IN')}`,
      });
    }

    const modelIds = competitors.map(c => c.model_id);

    // ── 2. Get specs for competitor models ──
    const { data: specsRows } = await supabase
      .from('specs')
      .select('*')
      .in('model_id', modelIds);
    const specsMap = {};
    (specsRows || []).forEach(s => { specsMap[s.model_id] = s; });

    // ── 3. Get tagged comments for competitors ──
    const { data: tagRows } = await supabase
      .from('tags')
      .select('comment_id, sentiment, mentions, strategic_theme')
      .in('comment_id', (
        await supabase.from('comments').select('id').in('model_id', modelIds)
          .then(r => (r.data || []).map(c => c.id))
      ));

    // also get comments with model_id for breakdown
    const { data: comments } = await supabase
      .from('comments')
      .select('id, model_id, source, comment_text, comment_date')
      .in('model_id', modelIds);

    const commentMap = {};
    (comments || []).forEach(c => { commentMap[c.id] = c; });

    // ── 4. Compute buzz per parameter across all competitors ──
    const paramStats = {};
    PARAMS.forEach(p => { paramStats[p] = { mentions: 0, pos: 0, neg: 0, verbatims: [] }; });

    (tagRows || []).forEach(tag => {
      if (!tag.mentions) return;
      const comment = commentMap[tag.comment_id];
      tag.mentions.forEach(m => {
        if (!paramStats[m.parameter]) return;
        paramStats[m.parameter].mentions++;
        if (m.sentiment === 'positive') paramStats[m.parameter].pos++;
        if (m.sentiment === 'negative') paramStats[m.parameter].neg++;
        // collect sample verbatims (max 3 per param)
        if (comment && paramStats[m.parameter].verbatims.length < 3) {
          paramStats[m.parameter].verbatims.push({
            text: comment.comment_text?.slice(0, 120),
            sentiment: m.sentiment,
            source: comment.source,
          });
        }
      });
    });

    // sort by mention volume
    const buzz = PARAMS
      .filter(p => paramStats[p].mentions > 0)
      .map(p => ({
        parameter: p,
        label: PARAM_LABELS[p],
        mentions: paramStats[p].mentions,
        positivity: paramStats[p].pos + paramStats[p].neg > 0
          ? Math.round(paramStats[p].pos / (paramStats[p].pos + paramStats[p].neg) * 100)
          : null,
        pos: paramStats[p].pos,
        neg: paramStats[p].neg,
        verbatims: paramStats[p].verbatims,
      }))
      .sort((a, b) => b.mentions - a.mentions);

    // ── 5. Per-model parameter sentiment ──
    const modelBuzz = {};
    competitors.forEach(c => { modelBuzz[c.model_id] = {}; });

    (tagRows || []).forEach(tag => {
      const comment = commentMap[tag.comment_id];
      if (!comment) return;
      const mid = comment.model_id;
      if (!modelBuzz[mid]) return;
      (tag.mentions || []).forEach(m => {
        if (!modelBuzz[mid][m.parameter]) modelBuzz[mid][m.parameter] = { pos: 0, neg: 0 };
        if (m.sentiment === 'positive') modelBuzz[mid][m.parameter].pos++;
        if (m.sentiment === 'negative') modelBuzz[mid][m.parameter].neg++;
      });
    });

    // ── 6. Build verdict if proposed_specs given ──
    let verdict = null;
    if (proposed_specs && Object.keys(proposed_specs).length > 0) {
      // compare proposed specs to segment average
      const segmentSpecs = specsRows || [];
      const avgBattery = segmentSpecs.filter(s => s.battery_mah).reduce((sum, s) => sum + s.battery_mah, 0) / (segmentSpecs.filter(s => s.battery_mah).length || 1);
      const maxBattery = Math.max(...segmentSpecs.filter(s => s.battery_mah).map(s => s.battery_mah), 0);

      verdict = {
        proposed: proposed_specs,
        segment_averages: {
          battery_mah: Math.round(avgBattery),
          battery_max: maxBattery,
        },
        strengths: [],
        weaknesses: [],
      };

      if (proposed_specs.battery_mah) {
        const pb = parseInt(proposed_specs.battery_mah);
        if (pb > avgBattery * 1.1) verdict.strengths.push(`Battery (${pb}mAh) is above segment average (${Math.round(avgBattery)}mAh)`);
        else if (pb < avgBattery * 0.9) verdict.weaknesses.push(`Battery (${pb}mAh) is below segment average (${Math.round(avgBattery)}mAh)`);
      }
    }

    // ── 7. Claude synthesis ──
    const topBuzz = buzz.slice(0, 5);
    const competitorSummary = competitors.map(c => {
      const sp = specsMap[c.model_id] || {};
      return `${c.model} (₹${c.launch_price_inr?.toLocaleString('en-IN')}): ${sp.battery_mah ? sp.battery_mah + 'mAh' : ''} ${sp.processor || ''} ${sp.rear_camera || ''} ${sp.display || ''}`;
    }).join('\n');

    const proposedSummary = proposed_specs
      ? Object.entries(proposed_specs).map(([k,v]) => `${k}: ${v}`).join(', ')
      : 'Not specified yet';

    const prompt = `You are a product strategy analyst for LAVA Mobiles, an Indian smartphone brand.

Target Price: ₹${price.toLocaleString('en-IN')} (${segment} segment, ₹${Math.round(priceLow).toLocaleString('en-IN')}–₹${Math.round(priceHigh).toLocaleString('en-IN')} band)
Platform Focus: ${platform_focus || 'Online'}

COMPETITORS IN THIS PRICE BAND:
${competitorSummary}

TOP CONSUMER BUZZ (by mention volume from ${(tagRows||[]).length} tagged comments):
${topBuzz.map(b => `- ${b.label}: ${b.mentions} mentions, ${b.positivity ?? '?'}% positive`).join('\n')}

PROPOSED PRODUCT SPECS:
${proposedSummary}

Give a crisp strategic recommendation with these exact sections:

## WINNING FORMULA
What spec + messaging combination wins in this segment based on consumer data? 2-3 sentences.

## YOUR PRODUCT ASSESSMENT
${proposed_specs ? 'Assess the proposed specs against competition and consumer buzz. Where do they win? Where are risks?' : 'No specs proposed yet. Suggest what specs would win based on competition and consumer buzz.'}

## MESSAGING ANGLE
What is the single most powerful message for ₹${price.toLocaleString('en-IN')}? One crisp tagline suggestion + 2-line rationale.

## WATCH OUT FOR
Top 2 risks or emerging issues in this segment.

Keep it sharp and specific. Use actual numbers from the data. Max 300 words total.
Respond strictly in English only — this is a professional product strategy tool.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const aiData = await aiRes.json();
    const synthesis = (aiData.content || []).find(b => b.type === 'text')?.text || '';

    res.status(200).json({
      target_price: price,
      segment,
      price_band: { low: Math.round(priceLow), high: Math.round(priceHigh) },
      competitors: competitors.map(c => ({
        ...c,
        specs: specsMap[c.model_id] || null,
        buzz: modelBuzz[c.model_id] || {},
      })),
      buzz,
      verdict,
      synthesis,
      total_comments_analysed: (tagRows || []).length,
    });

  } catch (e) {
    console.error('product-suggester failed:', e);
    res.status(500).json({ error: e.message });
  }
};
