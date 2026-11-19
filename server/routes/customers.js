const express = require('express');
const { query } = require('../config/db');
const { requirePermission } = require('../middlewares/auth');
const { audit } = require('../services/audit');
const { notFound, conflict, badRequest } = require('../errors');
const { str, optStr, digits, required, normalizeCpf, idParam, pagination } = require('../validation');

const router = express.Router();

function parse(body) {
  const data = {
    name: str(body.name),
    phone: digits(body.phone),
    cpf: normalizeCpf(body.cpf),
    address: optStr(body.address),
    notes: optStr(body.notes),
  };
  required({ nome: data.name, telefone: data.phone });
  if (data.phone.length < 10 || data.phone.length > 11) throw badRequest('Telefone deve ter DDD + número (10 ou 11 dígitos).');
  return data;
}

router.get('/', requirePermission('customers:read'), async (req, res, next) => {
  try {
    const { limit, offset, page } = pagination(req.query);
    const q = str(req.query.q);
    const params = [];
    let where = 'c.deleted_at IS NULL';
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const d = digits(q);
      where += ` AND (lower(c.name) LIKE $1${d ? ` OR c.phone LIKE $2 OR c.cpf LIKE $2` : ''})`;
      if (d) params.push(`%${d}%`);
    }
    const { rows } = await query(
      `SELECT c.id, c.name, c.phone, c.cpf, c.created_at,
              (SELECT count(*)::int FROM motorcycles m WHERE m.customer_id = c.id AND m.deleted_at IS NULL) AS motorcycles_count,
              count(*) OVER()::int AS total
         FROM customers c WHERE ${where}
        ORDER BY c.name LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ page, limit, total: rows[0] ? rows[0].total : 0, items: rows.map(({ total, ...r }) => r) });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('customers:read'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const { rows: [customer] } = await query('SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!customer) throw notFound('Cliente não encontrado.');
    const motorcycles = (await query(
      `SELECT id, brand, model, year, plate, color, current_km FROM motorcycles
        WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY brand, model`, [id])).rows;
    const workOrders = (await query(
      `SELECT w.id, w.number, w.status, w.opened_at, w.closed_at, m.plate, m.brand, m.model
         FROM work_orders w JOIN motorcycles m ON m.id = w.motorcycle_id
        WHERE w.customer_id = $1 ORDER BY w.opened_at DESC`, [id])).rows;
    res.json({ ...customer, motorcycles, workOrders });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('customers:write'), async (req, res, next) => {
  try {
    const d = parse(req.body);
    const { rows: [c] } = await query(
      `INSERT INTO customers (name, phone, cpf, address, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.name, d.phone, d.cpf, d.address, d.notes, req.user.id],
    );
    await audit(null, { userId: req.user.id, action: 'criar', entity: 'customers', entityId: c.id, ip: req.ip });
    res.status(201).json(c);
  } catch (err) {
    if (err.constraint === 'customers_cpf_uq') return next(conflict('Já existe um cliente com este CPF.'));
    next(err);
  }
});

router.put('/:id', requirePermission('customers:write'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const d = parse(req.body);
    const { rows: [c] } = await query(
      `UPDATE customers SET name=$2, phone=$3, cpf=$4, address=$5, notes=$6, updated_at=now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      [id, d.name, d.phone, d.cpf, d.address, d.notes],
    );
    if (!c) throw notFound('Cliente não encontrado.');
    await audit(null, { userId: req.user.id, action: 'editar', entity: 'customers', entityId: id, details: d, ip: req.ip });
    res.json(c);
  } catch (err) {
    if (err.constraint === 'customers_cpf_uq') return next(conflict('Já existe um cliente com este CPF.'));
    next(err);
  }
});

// RN10: exclusão (lógica) apenas quando não houver comandas nem motocicletas ativas vinculadas.
router.delete('/:id', requirePermission('customers:delete'), async (req, res, next) => {
  try {
    const id = idParam(req.params.id);
    const { rows: [rel] } = await query(
      `SELECT (SELECT count(*) FROM work_orders WHERE customer_id = $1)::int AS orders,
              (SELECT count(*) FROM motorcycles WHERE customer_id = $1 AND deleted_at IS NULL)::int AS motorcycles`, [id]);
    if (rel.orders > 0) throw conflict('Cliente possui comandas registradas e não pode ser excluído.', rel);
    if (rel.motorcycles > 0) throw conflict('Exclua ou transfira as motocicletas do cliente antes de excluí-lo.', rel);
    const r = await query('UPDATE customers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!r.rowCount) throw notFound('Cliente não encontrado.');
    await audit(null, { userId: req.user.id, action: 'excluir', entity: 'customers', entityId: id, ip: req.ip });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
