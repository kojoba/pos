import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { cookieOptions, issueToken, requireAuth } from '../auth.js';
const router = Router();
const publicUser = ({ id, username, name, role, phone }) => ({ id, username, name, role, phone });

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password.' });
  res.cookie('pos_session', issueToken(user), cookieOptions).json({ user: publicUser(user) });
});
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, name, role, phone FROM users WHERE id = ? AND active = 1').get(req.auth.id);
  if (!user) return res.status(401).json({ error: 'Account is inactive.' });
  res.json({ user });
});
router.post('/logout', (_req, res) => {
  res.clearCookie('pos_session', { ...cookieOptions, maxAge: undefined }).json({ ok: true });
});
export default router;
