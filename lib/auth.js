// lib/auth.js
// Lightweight password-gate auth — NOT a full user system. Two shared secrets:
//   VIEWER_PASSWORD — anyone who knows it can read the dashboard (many people)
//   ADMIN_PASSWORD  — only you; required for every write action
//
// On successful password check, we issue a signed, time-limited token (HMAC of an
// expiry timestamp + role, using a server-only secret). The token itself carries no
// user identity — it just proves "someone who knew the password asked before time X."
// This intentionally avoids needing a sessions table; verification is pure computation.

const crypto = require('crypto');

const TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || 'fallback-dev-secret-change-me';
const VIEWER_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;  // 12h ceiling; actual logout is on tab close (sessionStorage) client-side
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;    // 8h — admin sessions re-auth once per work session

function sign(payload) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
}

function issueToken(role) {
  const ttl = role === 'admin' ? ADMIN_TOKEN_TTL_MS : VIEWER_TOKEN_TTL_MS;
  const expiresAt = Date.now() + ttl;
  const payload = `${role}.${expiresAt}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function verifyToken(token, requiredRole) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [role, expiresAtStr, sig] = parts;
  const payload = `${role}.${expiresAtStr}`;
  const expectedSig = sign(payload);
  // constant-time comparison to avoid timing attacks on the signature check
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  if (requiredRole === 'admin') return role === 'admin';
  // viewer-level routes accept either a viewer or an admin token
  return role === 'viewer' || role === 'admin';
}

function requireAdmin(req, res) {
  const token = req.headers['x-auth-token'];
  if (!verifyToken(token, 'admin')) {
    res.status(401).json({ error: 'Admin authentication required for this action.' });
    return false;
  }
  return true;
}

function requireViewer(req, res) {
  const token = req.headers['x-auth-token'];
  if (!verifyToken(token, 'viewer')) {
    res.status(401).json({ error: 'Authentication required. Please reload and enter the dashboard password.' });
    return false;
  }
  return true;
}

module.exports = { issueToken, verifyToken, requireAdmin, requireViewer };
