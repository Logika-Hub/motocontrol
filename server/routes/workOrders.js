const express = require('express');
const { requirePermission } = require('../middlewares/auth');
const svc = require('../services/workOrders');
const { badRequest } = require('../lib/errors');
const { str, optStr, optInt, optDate, idParam, pagination } = require('../lib/validation');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.get('/', requirePermission('work_orders:read'), wrap(async (req, res) => {
  const pg = pagination(req.query);
  const filters = {
    number: optStr(req.query.number),
    plate: optStr(req.query.plate),
    customer: optStr(req.query.customer),
    model: optStr(req.query.model),
    status: optStr(req.query.status),
    userId: req.query.userId ? idParam(req.query.userId) : null,
    motorcycleId: req.query.motorcycleId ? idParam(req.query.motorcycleId) : null,
    from: optDate(req.query.from, 'data inicial'),
    to: optDate(req.query.to, 'data final'),
  };
  const result = await svc.search(filters, pg);
  res.json({ page: pg.page, limit: pg.limit, ...result });
}));

router.get('/:id', requirePermission('work_orders:read'), wrap(async (req, res) => {
  res.json(await svc.getDetail(idParam(req.params.id)));
}));

router.post('/', requirePermission('work_orders:create'), wrap(async (req, res) => {
  const data = {
    customerId: optInt(req.body.customerId, 'cliente', { min: 1 }),
    motorcycleId: optInt(req.body.motorcycleId, 'motocicleta', { min: 1 }),
    entryKm: optInt(req.body.entryKm, 'quilometragem'),
    complaint: str(req.body.complaint),
    notes: optStr(req.body.notes),
    expectedDelivery: optDate(req.body.expectedDelivery, 'previsão de entrega'),
  };
  if (!data.motorcycleId) throw badRequest('Selecione a motocicleta.');
  if (!data.complaint) throw badRequest('Informe a reclamação do cliente.');
  const wo = await svc.create(req.user, data, req.ip);
  res.status(201).json(await svc.getDetail(wo.id));
}));

router.patch('/:id', requirePermission('work_orders:edit_reception', 'work_orders:edit_technical'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  const body = { version: req.body.version };
  if (req.body.complaint !== undefined) body.complaint = str(req.body.complaint);
  if (req.body.entryKm !== undefined) body.entryKm = optInt(req.body.entryKm, 'quilometragem');
  if (req.body.expectedDelivery !== undefined) body.expectedDelivery = optDate(req.body.expectedDelivery, 'previsão de entrega');
  for (const k of ['identifiedProblems', 'diagnosis', 'notes']) if (req.body[k] !== undefined) body[k] = optStr(req.body[k]);
  await svc.editFields(req.user, id, body, req.ip);
  res.json(await svc.getDetail(id));
}));

router.post('/:id/status', requirePermission('work_orders:status'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.changeStatus(req.user, id, { status: str(req.body.status), version: req.body.version, note: optStr(req.body.note) }, req.ip);
  res.json(await svc.getDetail(id));
}));

router.post('/:id/finish', requirePermission('work_orders:finish'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.finish(req.user, id, { version: req.body.version, closingNotes: optStr(req.body.closingNotes) }, req.ip);
  res.json(await svc.getDetail(id));
}));

router.post('/:id/cancel', requirePermission('work_orders:cancel'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.cancel(req.user, id, { version: req.body.version, reason: optStr(req.body.reason) }, req.ip);
  res.json(await svc.getDetail(id));
}));

router.post('/:id/updates', requirePermission('work_orders:note', 'work_orders:diagnosis'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.addManualUpdate(req.user, id, { type: str(req.body.type) || 'observacao', description: str(req.body.description) }, req.ip);
  res.status(201).json(await svc.getDetail(id));
}));

router.post('/:id/updates/:updateId/correct', requirePermission('work_orders:note', 'work_orders:diagnosis'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.correctUpdate(req.user, id, idParam(req.params.updateId), { description: str(req.body.description) }, req.ip);
  res.status(201).json(await svc.getDetail(id));
}));

router.delete('/:id/updates/:updateId', requirePermission('work_orders:remove_update'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.removeUpdate(req.user, id, idParam(req.params.updateId), { reason: str(req.body && req.body.reason) }, req.ip);
  res.json(await svc.getDetail(id));
}));

router.post('/:id/items', requirePermission('work_orders:items'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.addItem(req.user, id, { kind: str(req.body.kind), description: str(req.body.description), quantity: req.body.quantity }, req.ip);
  res.status(201).json(await svc.getDetail(id));
}));

router.post('/:id/items/:itemId/done', requirePermission('work_orders:items'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.markItemDone(req.user, id, idParam(req.params.itemId), req.ip);
  res.json(await svc.getDetail(id));
}));

router.delete('/:id/items/:itemId', requirePermission('work_orders:items'), wrap(async (req, res) => {
  const id = idParam(req.params.id);
  await svc.removeItem(req.user, id, idParam(req.params.itemId), req.ip);
  res.json(await svc.getDetail(id));
}));

module.exports = router;
