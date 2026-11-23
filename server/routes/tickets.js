/** Chamados (chat) — D18. Abrir chamado fica em routes/workOrders.js (POST /work-orders/:id/tickets). */
const express = require('express');
const { requirePermission } = require('../middlewares/auth');
const svc = require('../services/tickets');
const { optStr, idParam, pagination } = require('../lib/validation');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/', requirePermission('tickets:use'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const status = optStr(req.query.status) || 'aberto'; // aberto | encerrado | todos
  res.json({ data: await svc.list(req.user, { status, limit: pg.limit, offset: pg.offset }), page: pg.page, limit: pg.limit });
}));

router.get('/summary', requirePermission('tickets:use'), wrap(async (req, res) => {
  res.json(await svc.summary(req.user));
}));

router.get('/:tid', requirePermission('work_orders:read'), wrap(async (req, res) => {
  res.json(await svc.getDetail(req.user, idParam(req.params.tid)));
}));

router.post('/:tid/messages', requirePermission('tickets:use'), wrap(async (req, res) => {
  const tid = idParam(req.params.tid);
  await svc.addMessage(req.user, tid, { body: req.body.body }, req.ip);
  res.status(201).json(await svc.getDetail(req.user, tid));
}));

router.post('/:tid/close', requirePermission('tickets:use'), wrap(async (req, res) => {
  const tid = idParam(req.params.tid);
  await svc.close(req.user, tid, { summary: req.body.summary }, req.ip);
  res.json(await svc.getDetail(req.user, tid));
}));

router.post('/:tid/read', requirePermission('tickets:use'), wrap(async (req, res) => {
  await svc.markRead(req.user, idParam(req.params.tid));
  res.status(204).end();
}));

module.exports = router;
