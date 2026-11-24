// Painéis financeiros e de desempenho, repasses e regras de comissão (D19).
// /me/* usa SEMPRE o usuário da sessão (nunca um id vindo da requisição): cada colaborador só enxerga os próprios dados.
// Todo o resto exige finance:admin.
const express = require('express');
const { requirePermission } = require('../middlewares/auth');
const finance = require('../services/finance');
const commissions = require('../services/commissions');
const { loadCollaborators } = require('../services/sales');
const { str, optStr, optDate, idParam, pagination } = require('../lib/validation');
const { badRequest } = require('../lib/errors');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const period = (q) => ({ from: optDate(q.from, 'data inicial'), to: optDate(q.to, 'data final'), group: optStr(q.group) });

// ---- Painel individual (próprios dados) ----
router.get('/me', requirePermission('finance:own'), wrap(async (req, res) => {
  res.json(await finance.userReport(req.user.id, period(req.query)));
}));
router.get('/me/services', requirePermission('finance:own'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  res.json({ page: pg.page, limit: pg.limit, ...(await finance.userServices(req.user.id, period(req.query), pg)) });
}));
router.get('/me/payouts', requirePermission('finance:own'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const p = period(req.query);
  res.json({ page: pg.page, limit: pg.limit, ...(await commissions.listPayouts({ userId: req.user.id, from: p.from, to: p.to }, pg)) });
}));

// ---- Administração ----
router.get('/overview', requirePermission('finance:admin'), wrap(async (req, res) => {
  res.json(await finance.overview(period(req.query)));
}));
router.get('/team/:userId', requirePermission('finance:admin'), wrap(async (req, res) => {
  res.json(await finance.userReport(idParam(req.params.userId), period(req.query)));
}));
router.get('/team/:userId/services', requirePermission('finance:admin'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  res.json({ page: pg.page, limit: pg.limit, ...(await finance.userServices(idParam(req.params.userId), period(req.query), pg)) });
}));
router.get('/team/:userId/payouts', requirePermission('finance:admin'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const p = period(req.query);
  res.json({ page: pg.page, limit: pg.limit, ...(await commissions.listPayouts({ userId: idParam(req.params.userId), from: p.from, to: p.to }, pg)) });
}));
router.get('/collaborators', requirePermission('finance:admin'), wrap(async (_req, res) => {
  res.json({ data: await loadCollaborators({ query: require('../config/db').query }) });
}));

router.get('/balances', requirePermission('finance:admin'), wrap(async (_req, res) => {
  res.json({ data: await commissions.balances() });
}));
router.get('/payouts', requirePermission('finance:admin'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const p = period(req.query);
  res.json({ page: pg.page, limit: pg.limit,
    ...(await commissions.listPayouts({ userId: req.query.userId ? idParam(req.query.userId) : null, from: p.from, to: p.to }, pg)) });
}));
router.post('/payouts', requirePermission('finance:admin'), wrap(async (req, res) => {
  const id = await commissions.createPayout(req.user, {
    userId: idParam(req.body.userId), amount: req.body.amount, method: str(req.body.method), note: optStr(req.body.note),
  }, req.ip);
  res.status(201).json({ id });
}));
router.post('/payouts/:id/cancel', requirePermission('finance:admin'), wrap(async (req, res) => {
  await commissions.cancelPayout(req.user, idParam(req.params.id), { reason: str(req.body.reason) }, req.ip);
  res.json({ ok: true });
}));

router.get('/rules', requirePermission('commissions:manage'), wrap(async (_req, res) => {
  res.json(await commissions.listRules());
}));
router.put('/rules', requirePermission('commissions:manage'), wrap(async (req, res) => {
  const userId = req.body.userId === null || req.body.userId === undefined || req.body.userId === '' ? null : idParam(req.body.userId);
  if (req.body.value === undefined || req.body.value === null || req.body.value === '') throw badRequest('Informe o valor da comissão.');
  const id = await commissions.setRule(req.user, { userId, type: str(req.body.type), value: req.body.value }, req.ip);
  res.json({ id });
}));
router.delete('/rules/:id', requirePermission('commissions:manage'), wrap(async (req, res) => {
  await commissions.endRule(req.user, idParam(req.params.id), req.ip);
  res.status(204).end();
}));

module.exports = router;
