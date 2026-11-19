const express = require('express');
const { query } = require('../config/db');
const { requirePermission } = require('../middlewares/auth');
const backup = require('../services/backup');
const { audit } = require('../services/audit');
const { notFound } = require('../lib/errors');
const { pagination, optStr } = require('../lib/validation');

const router = express.Router();

// Lista simples de funcionários para filtros (qualquer usuário autenticado com leitura de comandas).
router.get('/staff', requirePermission('work_orders:read'), async (_req, res, next) => {
  try {
    res.json((await query(
      `SELECT u.id, u.name, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name`)).rows);
  } catch (err) { next(err); }
});

router.get('/audit', requirePermission('audit:read'), async (req, res, next) => {
  try {
    const { limit, offset, page } = pagination(req.query);
    const params = [];
    const where = [];
    const entity = optStr(req.query.entity);
    if (entity) { params.push(entity); where.push(`a.entity = $${params.length}`); }
    if (req.query.userId) { params.push(Number(req.query.userId)); where.push(`a.user_id = $${params.length}`); }
    const { rows } = await query(
      `SELECT a.*, u.name AS user_name, count(*) OVER()::int AS total
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ page, limit, total: rows[0] ? rows[0].total : 0, items: rows.map(({ total, ...r }) => r) });
  } catch (err) { next(err); }
});

router.get('/backups', requirePermission('backups:manage'), (_req, res) => res.json(backup.listBackups()));

router.post('/backups', requirePermission('backups:manage'), async (req, res, next) => {
  try {
    const b = await backup.createBackup();
    await audit(null, { userId: req.user.id, action: 'gerar_backup', entity: 'backups', details: b, ip: req.ip });
    res.status(201).json(b);
  } catch (err) { next(err); }
});

router.get('/backups/:file', requirePermission('backups:manage'), async (req, res, next) => {
  try {
    const full = backup.backupPath(req.params.file);
    if (!full) throw notFound('Backup não encontrado.');
    await audit(null, { userId: req.user.id, action: 'baixar_backup', entity: 'backups', details: { file: req.params.file }, ip: req.ip });
    res.download(full);
  } catch (err) { next(err); }
});

module.exports = router;
