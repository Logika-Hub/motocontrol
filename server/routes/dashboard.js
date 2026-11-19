const express = require('express');
const { query } = require('../config/db');
const { requirePermission } = require('../middlewares/auth');
const { STATUS, formatNumber } = require('../services/workOrders');

const router = express.Router();

router.get('/', requirePermission('dashboard:read'), async (_req, res, next) => {
  try {
    const { rows: [counts] } = await query(`
      SELECT count(*) FILTER (WHERE status = 'aberta')::int            AS aberta,
             count(*) FILTER (WHERE status = 'em_diagnostico')::int    AS em_diagnostico,
             count(*) FILTER (WHERE status = 'aguardando_pecas')::int  AS aguardando_pecas,
             count(*) FILTER (WHERE status = 'em_execucao')::int       AS em_execucao,
             count(*) FILTER (WHERE status NOT IN ('concluida','cancelada'))::int AS em_andamento,
             count(*) FILTER (WHERE status = 'concluida' AND closed_at >= date_trunc('day', now()))::int AS concluidas_hoje,
             count(*) FILTER (WHERE status = 'concluida' AND closed_at >= date_trunc('month', now()))::int AS concluidas_mes,
             count(*) FILTER (WHERE status NOT IN ('concluida','cancelada') AND expected_delivery < current_date)::int AS atrasadas
        FROM work_orders`);

    const latest = (await query(`
      SELECT w.id, w.number, w.status, w.opened_at, c.name AS customer_name, m.brand, m.model, m.plate
        FROM work_orders w JOIN customers c ON c.id = w.customer_id JOIN motorcycles m ON m.id = w.motorcycle_id
       ORDER BY w.opened_at DESC LIMIT 8`)).rows
      .map((r) => ({ ...r, code: formatNumber(r.number), status_label: STATUS[r.status] }));

    const activity = (await query(`
      SELECT u.id, u.type, u.description, u.created_at, us.name AS user_name, r.name AS user_role,
             w.id AS work_order_id, w.number, m.plate
        FROM work_order_updates u
        JOIN users us ON us.id = u.user_id JOIN roles r ON r.id = us.role_id
        JOIN work_orders w ON w.id = u.work_order_id JOIN motorcycles m ON m.id = w.motorcycle_id
       WHERE u.removed_at IS NULL
       ORDER BY u.created_at DESC, u.id DESC LIMIT 15`)).rows
      .map((r) => ({ ...r, code: formatNumber(r.number) }));

    res.json({ counts, latest, activity });
  } catch (err) { next(err); }
});

module.exports = router;
