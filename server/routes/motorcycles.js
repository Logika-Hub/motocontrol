const express = require('express');
const { query } = require('../config/db');
const { requirePermission } = require('../middlewares/auth');
const { audit } = require('../services/audit');
const { notFound, conflict, badRequest } = require('../errors');
const { str, optStr, required, optInt, normalizePlate, idParam, pagination } = require('../validation');

const router = express.Router();

async function parse(body) {
  const data = {
    customer_id: optInt(body.customerId, 'proprietário', { min: 1 }),
    brand: str(body.brand),
    model: str(body.model),
    year: optInt(body.year, 'ano', { min: 1900, max: new Date().getFullYear() + 1 }),
    plate: normalizePlate(body.plate),
    color: optStr(body.color),
    current_km: optInt(body.currentKm, 'quilometragem'),
    notes: optStr(body.notes),
  };
  required({ proprietario: data.customer_id, marca: data.brand, modelo: data.model, ano: data.year, placa: data.plate });
  const { rowCount } = await query('SELECT 1 FROM customers WHERE id = $1 AND deleted_at IS NULL', [data.customer_id]);
  if (!rowCount) throw badRequest('Proprietário não encontrado.');
  return data;
}

const plateConflict = (err) => err.constraint === 'motorcycles_plate_uq' && conflict('Já existe uma motocicleta com esta placa.');

router.get('/', requirePermission('motorcycles:read'), async (req, res, next) => {
  try {
    const { limit, offset, page } = pagination(req.query);
    const q = str(req.query.q);
    const params = [];
    let where = 'm.deleted_at IS NULL';
    if (req.query.customerId) {
      params.push(idParam(req.query.customerId));
      where += ` AND m.customer_id = $${params.length}`;
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const p = `$${params.length}`;
      params.push(`%${q.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`);
      where += ` AND (m.plate LIKE $${params.length} OR lower(m.model) LIKE ${p} OR lower(m.brand) LIKE ${p} OR lower(c.name) LIKE ${p})`;
    }
    const { rows } = await query(
      `SELECT m.id, m.brand, m.model, m.year, m.plate, m.color, m.current_km, m.customer_id, c.name AS customer_name,
              (SELECT w.status FROM work_orders w WHERE w.motorcycle_id = m.id ORDER BY w.opened_at DESC LIMIT 1) AS last_status,
              count(*) OVER()::int AS total
         FROM motorcycles m JOIN customers c ON c.id = m.customer_id
        WHERE ${where} ORDER BY m.plate LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ page, limit, total: rows[0] ? rows[0].total : 0, items: rows.map(({ total, ...r }) => r) });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('motorcycles:read'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const { rows: [m] } = await query(
      `SELECT m.*, c.name AS customer_name, c.phone AS customer_phone
         FROM motorcycles m JOIN customers c ON c.id = m.customer_id
        WHERE m.id = $1 AND m.deleted_at IS NULL`, [id]);
    if (!m) throw notFound('Motocicleta não encontrada.');
    // Histórico de manutenção: todas as comandas do veículo com serviços realizados.
    const history = (await query(
      `SELECT w.id, w.number, w.status, w.opened_at, w.closed_at, w.entry_km, w.complaint, w.diagnosis,
              u.name AS opened_by_name,
              COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'description', i.description, 'quantity', i.quantity, 'status', i.status) ORDER BY i.id)
                          FROM work_order_items i WHERE i.work_order_id = w.id AND i.removed_at IS NULL), '[]') AS items
         FROM work_orders w JOIN users u ON u.id = w.opened_by
        WHERE w.motorcycle_id = $1 ORDER BY w.opened_at DESC`, [id])).rows;
    res.json({ ...m, history });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('motorcycles:write'), async (req, res, next) => {
  try {
    const d = await parse(req.body);
    const { rows: [m] } = await query(
      `INSERT INTO motorcycles (customer_id, brand, model, year, plate, color, current_km, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.customer_id, d.brand, d.model, d.year, d.plate, d.color, d.current_km, d.notes, req.user.id],
    );
    await audit(null, { userId: req.user.id, action: 'criar', entity: 'motorcycles', entityId: m.id, details: { plate: m.plate }, ip: req.ip });
    res.status(201).json(m);
  } catch (err) { next(plateConflict(err) || err); }
});

router.put('/:id', requirePermission('motorcycles:write'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const d = await parse(req.body);
    const { rows: [before] } = await query('SELECT customer_id FROM motorcycles WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!before) throw notFound('Motocicleta não encontrada.');
    const { rows: [m] } = await query(
      `UPDATE motorcycles SET customer_id=$2, brand=$3, model=$4, year=$5, plate=$6, color=$7, current_km=$8, notes=$9, updated_at=now()
        WHERE id = $1 RETURNING *`,
      [id, d.customer_id, d.brand, d.model, d.year, d.plate, d.color, d.current_km, d.notes],
    );
    await audit(null, {
      userId: req.user.id, action: before.customer_id !== d.customer_id ? 'transferir_proprietario' : 'editar',
      entity: 'motorcycles', entityId: id, details: { ...d, previous_customer_id: before.customer_id }, ip: req.ip,
    });
    res.json(m);
  } catch (err) { next(plateConflict(err) || err); }
});

router.delete('/:id', requirePermission('motorcycles:delete'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const { rows: [rel] } = await query('SELECT count(*)::int AS orders FROM work_orders WHERE motorcycle_id = $1', [id]);
    if (rel.orders > 0) throw conflict('Motocicleta possui comandas registradas e não pode ser excluída.', rel);
    const r = await query('UPDATE motorcycles SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!r.rowCount) throw notFound('Motocicleta não encontrada.');
    await audit(null, { userId: req.user.id, action: 'excluir', entity: 'motorcycles', entityId: id, ip: req.ip });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
