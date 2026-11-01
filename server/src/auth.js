import jwt from 'jsonwebtoken';
import { db } from './db.js';

const secret = process.env.JWT_SECRET;
if (!secret || secret === 'replace-this-with-a-long-random-secret-before-deployment') {
  if (process.env.NODE_ENV === 'production') throw new Error('Set a unique JWT_SECRET in production.');
}
const signingSecret = secret || 'local-development-secret-change-before-deploying';
export const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
  path: '/', maxAge: 1000 * 60 * 60 * 12,
};
export function issueToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, signingSecret, { expiresIn: '12h' });
}
export function requireAuth(req, res, next) {
  const token = req.cookies?.pos_session;
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const claims = jwt.verify(token, signingSecret);
    const user = db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(claims.id);
    if (!user || !user.active) {
      res.clearCookie('pos_session', { ...cookieOptions, maxAge: undefined });
      return res.status(401).json({ error: 'Your account is inactive. Please contact a manager.' });
    }
    req.auth = { id: user.id, role: user.role };
    next();
  } catch {
    res.clearCookie('pos_session', { ...cookieOptions, maxAge: undefined });
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
export function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.auth?.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do that.' });
}
