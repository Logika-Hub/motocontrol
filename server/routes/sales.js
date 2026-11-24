const express = require('express');
const { requirePermission } = require('../middlewares/auth');
const { can } = require('../config/permissions');
const svc = require('../services/sales');
const { badRequest } = require('../lib/errors');
const { str, optStr, optDate, idParam, pagination } = require('../lib/validation');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Corpo do fechamento/prévia: o servidor recalcula tudo; aqui só entram preços, responsáveis, desconto e pagamentos.
function closingBody(b) {
  if (!b || typeof b !== 'object') throw badRequest('Dados do fechamento ausentes.');
  return { items: b.items, discount: b.discount, payments: b.payments, notes: b.notes };
}

router.get('/', requirePermission('sales:read'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const result = await svc.list({
    from: optDate(req.query.from, 'data inicial'), to: optDate(req.query.to, 'data final'),
    status: optStr(req.query.status), method: optStr(req.query.method), q: optStr(req.query.q),
    userId: req.query.userId ? idParam(req.query.userId) : null,
  }, pg);
  res.json({ page: pg.page, limit: pg.limit, ...result });
}));

router.get('/awaiting', requirePermission('sales:close'), wrap(async (_req, res) => {
  res.json({ data: await svc.awaiting() });
}));

router.get('/closing/:workOrderId', requirePermission('sales:close'), wrap(async (req, res) => {
  res.json(await svc.closingData(idParam(req.params.workOrderId)));
}));

router.post('/preview', requirePermission('sales:close'), wrap(async (req, res) => {
  res.json(await svc.preview(idParam(req.body.workOrderId), closingBody(req.body), { withCommissions: can(req.user.role, 'finance:admin') }));
}));

router.post('/', requirePermission('sales:close'), wrap(async (req, res) => {
  const id = await svc.close(req.user, idParam(req.body.workOrderId), closingBody(req.body), req.ip);
  res.status(201).json(await svc.getSale(id, { withCommissions: can(req.user.role, 'finance:admin') }));
}));

router.get('/:id', requirePermission('sales:read'), wrap(async (req, res) => {
  res.json(await svc.getSale(idParam(req.params.id), { withCommissions: can(req.user.role, 'finance:admin') }));
}));

router.post('/:id/void', requirePermission('sales:void'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.voidSale(req.user, id, { reason: str(req.body.reason) }, req.ip);
  res.json(await svc.getSale(id, { withCommissions: true }));
}));

module.exports = router;
