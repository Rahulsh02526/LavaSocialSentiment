// api/auth-viewer.js
// POST /api/auth-viewer
// Body: { password }
// Checks against VIEWER_PASSWORD env var. On success, issues a viewer-level token.
// Note: VIEWER_PASSWORD is intentionally shareable — many colleagues will know it.

const { issueToken } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.VIEWER_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'Server is missing VIEWER_PASSWORD env var.' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password is required.' });

  if (password !== expected) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = issueToken('viewer');
  res.status(200).json({ token });
};
