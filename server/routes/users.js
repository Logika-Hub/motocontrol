const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { requirePermission } = require('../middlewares/auth');
const { audit } = require('../services/audit');
const { badRequest, notFound } = require('../errors');
const { str, required, idParam } = require('../validation');

const router = express.Router();
router.use(requirePermission('users:manage'));

const SELECT = `SELECT u.id, u.name, u.username, u.active, u.must_change_password, u.last_login_at, u.created_at,
                       r.code AS role, r.name AS role_name
                  FROM users u JOIN roles r ON r.id = u.role_id`;

async function roleId(code) {
  const { rows } = await query('SELECT id FROM roles WHERE code = $1', [code]);
  if (!rows[0]) throw badRequest('Perfil inválido.');
  return rows[0].id;
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 6) throw badRequest('A senha deve ter ao menos 6 caracteres.');
}

async function dropSessions(userId) {
  await query(`DELETE FROM user_sessions WHERE (sess->>'userId')::int = $1`, [userId]);
}

router.get('/roles', async (_req, res, next) => {
  try {
    res.json((await query('SELECT code, name FROM roles ORDER BY id')).rows);
  } catch (err) { next(err); }
});

router.get('/', async (_req, res, next) => {
  try {
    res.json((await query(`${SELECT} ORDER BY u.active DESC, u.name`)).rows);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = str(req.body.name);
    const username = str(req.body.username).toLowerCase();
    required({ nome: name, usuario: username, perfil: str(req.body.role) });
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
      throw badRequest('Usuário deve ter de 3 a 50 caracteres (letras minúsculas, números, ponto, hífen).');
    }
    checkPassword(req.body.password);
    const rid = await roleId(str(req.body.role));
    const hash = await bcrypt.hash(req.body.password, 10);
    const { rows } = await query(
      `INSERT INTO users (role_id, name, username, password_hash, must_change_password)
       VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
      [rid, name, username, hash],
    );
    await audit(null, { userId: req.user.id, action: 'criar', entity: 'users', entityId: rows[0].id, details: { username, role: req.body.role }, ip: req.ip });
    res.status(201).json((await query(`${SELECT} WHERE u.id = $1`, [rows[0].id])).rows[0]);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const { rows: [current] } = await query(`${SELECT} WHERE u.id = $1`, [id]);
    if (!current) throw notFound();

    const changes = {};
    if (req.body.name !== undefined) {
      changes.name = str(req.body.name);
      required({ nome: changes.name });
    }
    if (req.body.role !== undefined) changes.role_id = await roleId(str(req.body.role));
    if (req.body.active !== undefined) changes.active = Boolean(req.body.active);

    if (id === req.user.id && (changes.active === false || (changes.role_id && req.body.role !== 'admin'))) {
      throw badRequest('Você não pode desativar ou rebaixar a sua própria conta.');
    }
    const keys = Object.keys(changes);
    if (!keys.length) throw badRequest('Nenhuma alteração informada.');

    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await query(`UPDATE users SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...keys.map((k) => changes[k])]);
    if (changes.active === false) await dropSessions(id); // efeito imediato

    const { password, ...logged } = req.body; // eslint-disable-line no-unused-vars
    await audit(null, { userId: req.user.id, action: 'editar', entity: 'users', entityId: id, details: logged, ip: req.ip });
    res.json((await query(`${SELECT} WHERE u.id = $1`, [id])).rows[0]);
  } catch (err) { next(err); }
});

router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    checkPassword(req.body.password);
    const hash = await bcrypt.hash(req.body.password, 10);
    const r = await query('UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = now() WHERE id = $2', [hash, id]);
    if (!r.rowCount) throw notFound();
    if (id !== req.user.id) await dropSessions(id);
    await audit(null, { userId: req.user.id, action: 'redefinir_senha', entity: 'users', entityId: id, ip: req.ip });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
