// api/auth-admin.js
// POST /api/auth-admin
// Body: { password }
// Checks against ADMIN_PASSWORD env var. On success, issues an admin-level token,
// which also satisfies viewer-level checks (admin can do everything a viewer can).

const { issueToken } = require('../lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'Server is missing ADMIN_PASSWORD env var.' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password is required.' });

  if (password !== expected) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = issueToken('admin');
  res.status(200).json({ token });
};
