const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { requireAuth } = require('../middlewares/auth');
const { PERMISSIONS } = require('../config/permissions');
const { audit } = require('../services/audit');
const { AppError, badRequest } = require('../lib/errors');
const { str } = require('../lib/validation');

const router = express.Router();

// Limite simples contra tentativa de senha por força bruta (por IP + usuário).
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    roleName: user.role_name,
    mustChangePassword: user.must_change_password,
    permissions: PERMISSIONS[user.role] || [],
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const username = str(req.body.username).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!username || !password) throw badRequest('Informe usuário e senha.');

    const key = `${req.ip}|${username}`;
    const entry = attempts.get(key);
    if (entry && entry.count >= MAX_ATTEMPTS && Date.now() - entry.last < LOCK_MS) {
      throw new AppError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }

    const { rows } = await query(
      `SELECT u.*, r.code AS role, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
        WHERE lower(u.username) = $1`,
      [username],
    );
    const user = rows[0];
    const ok = user && user.active && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      attempts.set(key, { count: (entry && Date.now() - entry.last < LOCK_MS ? entry.count : 0) + 1, last: Date.now() });
      await audit(null, { userId: user ? user.id : null, action: 'login_falhou', entity: 'auth', details: { username }, ip: req.ip });
      throw new AppError(401, 'Usuário ou senha inválidos.');
    }
    attempts.delete(key);

    req.session.regenerate(async (err) => {
      if (err) return next(err);
      try {
        req.session.userId = user.id;
        await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
        await audit(null, { userId: user.id, action: 'login', entity: 'auth', ip: req.ip });
        res.json({ user: userPayload(user) });
      } catch (e) {
        next(e);
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  const userId = req.user ? req.user.id : null;
  req.session.destroy(async (err) => {
    if (err) return next(err);
    if (userId) await audit(null, { userId, action: 'logout', entity: 'auth', ip: req.ip }).catch(() => {});
    res.clearCookie('motocontrol.sid');
    res.status(204).end();
  });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: userPayload(req.user) }));

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw badRequest('A nova senha deve ter ao menos 6 caracteres.');
    }
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) {
      throw badRequest('Senha atual incorreta.');
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = now() WHERE id = $2', [hash, req.user.id]);
    await audit(null, { userId: req.user.id, action: 'alterar_senha', entity: 'users', entityId: req.user.id, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
