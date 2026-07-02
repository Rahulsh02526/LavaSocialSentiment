// api/tag.js
// POST /api/tag
// Body: { comments: [{ id, comment_text }, ...] }   (max ~25 per call, matching the artifact version's batching)
// Calls Claude server-side (key never touches the browser), writes results to
// the `tags` table, and returns the tags so the frontend can update its UI immediately.

const { getSupabaseClient } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');

const TAGGING_SYSTEM_PROMPT = `You are analyzing smartphone reviews for LAVA International's Social Intelligence Platform.

Given comments about a smartphone model, analyze each comment across 4 layers.

LAYER 1 — Overall sentiment: positive | negative | neutral | mixed

LAYER 2 — Parameter mentions (use only these):
battery, camera_back, camera_front, display, performance, processor, storage, memory, looks, heating, sound, software, value, charging, wifi, nfc, overall
A comment can mention multiple parameters, each with its own sentiment (positive/negative/mixed).

LAYER 3 — Narrative: Extract the core phrase that captures WHAT the person is saying (3-6 words max). Examples: "battery drain after update", "camera king in segment", "heating issue during gaming", "best value for money". If no specific narrative, use null.

LAYER 4 — Strategic theme (assign ONE if clearly present, else null):
gaming_identity | value_seeking | camera_aspiration | social_signaling | trust_deficit | performance_seeker | design_conscious | reliability_concern

Respond ONLY with a JSON array, one object per input comment, in the same order as input, with this exact shape:
{"sentiment": "positive|negative|neutral|mixed", "mentions": [{"parameter": "battery", "sentiment": "positive"}], "narrative": "short phrase or null", "strategic_theme": "one of the 8 themes or null"}

If a comment has no clear parameter, use [{"parameter": "overall", "sentiment": "..."}].
No preamble, no markdown fences, no explanation. Just the JSON array.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAdmin(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Vercel project settings.' });
  }

  const { comments } = req.body || {};
  if (!Array.isArray(comments) || comments.length === 0) {
    return res.status(400).json({ error: 'Body must include a non-empty "comments" array.' });
  }
  if (comments.length > 30) {
    return res.status(400).json({ error: 'Max 30 comments per call — batch on the client side.' });
  }

  try {
    const userContent = comments.map((c, i) => `[${i}] ${c.comment_text}`).join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: TAGGING_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Tag these ${comments.length} comments:\n\n${userContent}` }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      throw new Error(claudeData?.error?.message || `Claude API returned ${claudeRes.status}`);
    }

    const textBlock = (claudeData.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text content in Claude response');

    let cleaned = textBlock.text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
    const parsedTags = JSON.parse(cleaned);

    if (!Array.isArray(parsedTags) || parsedTags.length !== comments.length) {
      throw new Error(`Expected ${comments.length} tags, got ${Array.isArray(parsedTags) ? parsedTags.length : 'non-array'}`);
    }

    const supabase = getSupabaseClient();
    const rows = comments.map((c, i) => ({
      comment_id: c.id,
      sentiment: parsedTags[i].sentiment,
      mentions: parsedTags[i].mentions,
      narrative: parsedTags[i].narrative,
      strategic_theme: parsedTags[i].strategic_theme,
    }));

    const { error: upsertError } = await supabase.from('tags').upsert(rows, { onConflict: 'comment_id' });
    if (upsertError) throw new Error(`Failed to save tags: ${upsertError.message}`);

    res.status(200).json({ tags: parsedTags, comment_ids: comments.map(c => c.id) });
  } catch (e) {
    console.error('POST /api/tag failed:', e);
    res.status(500).json({ error: e.message });
  }
};
