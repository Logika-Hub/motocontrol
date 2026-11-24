// Relatórios financeiros e de desempenho (D19). Tudo calculado no banco a partir de vendas ATIVAS (status 'concluida'),
// repasses ATIVOS e itens da venda: nada é estimado nem guardado como total.
const { query } = require('../config/db');
const { badRequest, notFound } = require('../lib/errors');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const MAX_DAYS = 1100;

/** Período em datas (inclusive). Sem filtros: do dia 1º do mês corrente até hoje. */
async function resolvePeriod({ from, to, group }) {
  const { rows: [p] } = await query(
    `SELECT COALESCE($1::date, date_trunc('month', now())::date) AS from, COALESCE($2::date, current_date) AS to`, [from || null, to || null]);
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
  if (days < 1) throw badRequest('A data inicial deve ser anterior ou igual à data final.');
  if (days > MAX_DAYS) throw badRequest('Período muito longo (máximo de cerca de 3 anos).');
  const g = ['day', 'week', 'month'].includes(group) ? group : days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
  return { from: p.from, to: p.to, days, group: g };
}

const inPeriod = (col) => `${col} >= $1::date AND ${col} < ($2::date + 1)`;

// ---- Relatório de um colaborador (usado no painel pessoal e na visão do administrador) --------------------

async function userReport(userId, q) {
  const { rows: [u] } = await query(
    'SELECT u.id, u.name, u.active, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [userId]);
  if (!u) throw notFound('Colaborador não encontrado.');
  const period = await resolvePeriod(q);
  const P = [period.from, period.to, userId];

  const { rows: [s] } = await query(
    `SELECT COALESCE(sum(si.net_amount), 0) AS sold, count(*)::int AS services, count(DISTINCT s.id)::int AS sales,
            COALESCE(sum(si.commission_amount), 0) AS commission
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.user_id = $3 AND s.status = 'concluida' AND ${inPeriod('s.closed_at')}`, P);
  const { rows: [paidPeriod] } = await query(
    `SELECT COALESCE(sum(amount), 0) AS paid FROM commission_payouts WHERE user_id = $3 AND status = 'ativo' AND ${inPeriod('paid_at')}`, P);
  const { rows: [all] } = await query(
    `SELECT (SELECT COALESCE(sum(si.commission_amount), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status = 'concluida' AND si.user_id = $1) AS earned,
            (SELECT COALESCE(sum(amount), 0) FROM commission_payouts WHERE user_id = $1 AND status = 'ativo') AS paid`, [userId]);

  return finishUserReport(u, period, s, paidPeriod, all, P);
}

/** Evolução do colaborador por dia/semana/mês: vendido, serviços, comissão gerada e repasses recebidos. */
async function userSeries(period, userId) {
  const { rows } = await query(
    `SELECT b.d::date AS bucket, COALESCE(x.sold, 0) AS sold, COALESCE(x.services, 0) AS services,
            COALESCE(x.commission, 0) AS commission, COALESCE(y.paid, 0) AS paid
       FROM generate_series(date_trunc($3::text, $1::date)::date, $2::date, ('1 ' || $3::text)::interval) AS b(d)
       LEFT JOIN (SELECT date_trunc($3::text, s.closed_at)::date AS d, sum(si.net_amount) AS sold, count(*) AS services, sum(si.commission_amount) AS commission
                    FROM sale_items si JOIN sales s ON s.id = si.sale_id
                   WHERE si.user_id = $4 AND s.status = 'concluida' AND ${inPeriod('s.closed_at')} GROUP BY 1) x ON x.d = b.d::date
       LEFT JOIN (SELECT date_trunc($3::text, paid_at)::date AS d, sum(amount) AS paid FROM commission_payouts
                   WHERE user_id = $4 AND status = 'ativo' AND ${inPeriod('paid_at')} GROUP BY 1) y ON y.d = b.d::date
      ORDER BY b.d`, [period.from, period.to, period.group, userId]);
  // Acumulados dentro do período (a distância entre as duas curvas é o que ainda está por receber).
  let accCommission = 0;
  let accPaid = 0;
  return rows.map((r) => {
    accCommission += Number(r.commission);
    accPaid += Number(r.paid);
    return { bucket: r.bucket, sold: r2(r.sold), services: Number(r.services), commission: r2(r.commission), paid: r2(r.paid),
      commission_acc: r2(accCommission), paid_acc: r2(accPaid) };
  });
}

async function finishUserReport(u, period, s, paidPeriod, all, P) {
  const userId = u.id;
  const evolution = await userSeries(period, userId);
  const { rows: top } = await query(
    `SELECT min(si.description) AS description, count(*)::int AS count, sum(si.net_amount) AS amount
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.user_id = $3 AND s.status = 'concluida' AND ${inPeriod('s.closed_at')}
      GROUP BY lower(si.description) ORDER BY count(*) DESC, sum(si.net_amount) DESC LIMIT 8`, P);
  return {
    user: { id: u.id, name: u.name, role_name: u.role_name, active: u.active },
    period,
    summary: { // dentro do período
      sold: r2(s.sold), services: s.services, sales: s.sales,
      average_ticket: s.sales ? r2(s.sold / s.sales) : 0,
      commission_earned: r2(s.commission), paid: r2(paidPeriod.paid),
    },
    totals: { // histórico completo
      earned: r2(all.earned), paid: r2(all.paid), pending: r2(Number(all.earned) - Number(all.paid)),
    },
    evolution,
    top_services: top.map((t) => ({ description: t.description, count: t.count, amount: r2(t.amount) })),
  };
}

async function userServices(userId, q, { limit, offset }) {
  const period = await resolvePeriod(q);
  const { rows } = await query(
    `SELECT si.id, s.id AS sale_id, s.status AS sale_status, s.closed_at, w.id AS work_order_id, w.number, si.description, si.quantity,
            si.net_amount, si.commission_amount, si.commission_type, si.commission_value, c.name AS customer_name, m.plate,
            count(*) OVER()::int AS total_rows
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN work_orders w ON w.id = s.work_order_id
       JOIN customers c ON c.id = w.customer_id JOIN motorcycles m ON m.id = w.motorcycle_id
      WHERE si.user_id = $3 AND ${inPeriod('s.closed_at')}
      ORDER BY s.closed_at DESC, si.id DESC LIMIT ${limit} OFFSET ${offset}`, [period.from, period.to, userId]);
  const { formatNumber } = require('./workOrders');
  return { period, total: rows[0] ? rows[0].total_rows : 0, items: rows.map(({ total_rows, ...r }) => ({ ...r, code: formatNumber(r.number) })) };
}

// ---- Visão geral do administrador -------------------------------------------------------------------------

async function overview(q) {
  const period = await resolvePeriod(q);
  const P = [period.from, period.to];

  const { rows: [sales] } = await query(
    `SELECT COALESCE(sum(total), 0) AS revenue, count(*)::int AS sales, COALESCE(sum(discount), 0) AS discounts
       FROM sales s WHERE s.status = 'concluida' AND ${inPeriod('s.closed_at')}`, P);
  const { rows: [items] } = await query(
    `SELECT count(*) FILTER (WHERE si.kind = 'servico')::int AS services,
            COALESCE(sum(si.net_amount) FILTER (WHERE si.kind = 'servico'), 0) AS services_amount,
            COALESCE(sum(si.net_amount) FILTER (WHERE si.kind = 'peca'), 0) AS parts_amount,
            COALESCE(sum(si.commission_amount), 0) AS commission_earned
       FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status = 'concluida' AND ${inPeriod('s.closed_at')}`, P);
  const { rows: [paid] } = await query(
    `SELECT COALESCE(sum(amount), 0) AS paid FROM commission_payouts WHERE status = 'ativo' AND ${inPeriod('paid_at')}`, P);
  const { rows: [voided] } = await query(
    `SELECT count(*)::int AS count, COALESCE(sum(total), 0) AS amount FROM sales WHERE status = 'estornada' AND ${inPeriod('voided_at')}`, P);
  const { rows: [awaiting] } = await query(
    `SELECT count(*)::int AS count,
            COALESCE(sum((SELECT sum(round(i.quantity * i.unit_price, 2)) FROM work_order_items i WHERE i.work_order_id = w.id AND i.removed_at IS NULL)), 0) AS priced_total
       FROM work_orders w WHERE w.status = 'concluida' AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.work_order_id = w.id AND s.status = 'concluida')`);

  const by_method = (await query(
    `SELECT sp.method, sum(sp.amount) AS amount, count(DISTINCT s.id)::int AS sales
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.status = 'concluida' AND ${inPeriod('s.closed_at')}
      GROUP BY sp.method ORDER BY sum(sp.amount) DESC`, P)).rows.map((r) => ({ ...r, amount: r2(r.amount) }));

  const { rows: evo } = await query(
    `SELECT b.d::date AS bucket, COALESCE(x.revenue, 0) AS revenue, COALESCE(x.sales, 0) AS sales
       FROM generate_series(date_trunc($3::text, $1::date)::date, $2::date, ('1 ' || $3::text)::interval) AS b(d)
       LEFT JOIN (SELECT date_trunc($3::text, closed_at)::date AS d, sum(total) AS revenue, count(*) AS sales FROM sales s
                   WHERE s.status = 'concluida' AND ${inPeriod('s.closed_at')} GROUP BY 1) x ON x.d = b.d::date ORDER BY b.d`,
    [period.from, period.to, period.group]);

  const topBase = `SELECT min(si.description) AS description, count(*)::int AS count, sum(si.net_amount) AS amount
       FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.kind = 'servico' AND s.status = 'concluida' AND ${inPeriod('s.closed_at')}
      GROUP BY lower(si.description)`;
  const fmtTop = (rows) => rows.map((t) => ({ description: t.description, count: t.count, amount: r2(t.amount) }));
  const top_by_count = fmtTop((await query(`${topBase} ORDER BY count(*) DESC, sum(si.net_amount) DESC LIMIT 8`, P)).rows);
  const top_by_amount = fmtTop((await query(`${topBase} ORDER BY sum(si.net_amount) DESC, count(*) DESC LIMIT 8`, P)).rows);

  const team = await teamTable(period);
  const revenue = r2(sales.revenue);
  return {
    period,
    summary: {
      revenue, sales: sales.sales, average_ticket: sales.sales ? r2(revenue / sales.sales) : 0, discounts: r2(sales.discounts),
      services: items.services, services_amount: r2(items.services_amount), parts_amount: r2(items.parts_amount),
      commission_earned: r2(items.commission_earned), commission_paid: r2(paid.paid),
      pending_commissions: r2(team.reduce((s, t) => s + Math.max(t.pending_total, 0), 0)),
      overpaid: r2(team.reduce((s, t) => s + Math.max(-t.pending_total, 0), 0)),
      voided_count: voided.count, voided_amount: r2(voided.amount),
      awaiting_closing: awaiting.count, awaiting_closing_amount: r2(awaiting.priced_total),
    },
    evolution: evo.map((r) => ({ bucket: r.bucket, revenue: r2(r.revenue), sales: Number(r.sales) })),
    by_method, top_by_count, top_by_amount,
    team, ranking: buildRanking(team),
  };
}

/** Resultado individual de cada colaborador no período + saldo pendente (histórico completo). */
async function teamTable(period) {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name, u.active, r.name AS role_name,
            COALESCE(a.sold, 0) AS sold, COALESCE(a.services, 0)::int AS services, COALESCE(a.sales, 0)::int AS sales,
            COALESCE(a.commission, 0) AS commission_earned, COALESCE(p.paid, 0) AS paid,
            COALESCE(te.earned, 0) - COALESCE(tp.paid, 0) AS pending_total
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN (SELECT si.user_id, sum(si.net_amount) AS sold, count(*) AS services, count(DISTINCT s.id) AS sales, sum(si.commission_amount) AS commission
                    FROM sale_items si JOIN sales s ON s.id = si.sale_id
                   WHERE s.status = 'concluida' AND si.user_id IS NOT NULL AND ${inPeriod('s.closed_at')} GROUP BY si.user_id) a ON a.user_id = u.id
       LEFT JOIN (SELECT user_id, sum(amount) AS paid FROM commission_payouts WHERE status = 'ativo' AND ${inPeriod('paid_at')} GROUP BY user_id) p ON p.user_id = u.id
       LEFT JOIN (SELECT si.user_id, sum(si.commission_amount) AS earned FROM sale_items si JOIN sales s ON s.id = si.sale_id
                   WHERE s.status = 'concluida' AND si.user_id IS NOT NULL GROUP BY si.user_id) te ON te.user_id = u.id
       LEFT JOIN (SELECT user_id, sum(amount) AS paid FROM commission_payouts WHERE status = 'ativo' GROUP BY user_id) tp ON tp.user_id = u.id
      WHERE r.code <> 'consulta' AND (u.active OR a.user_id IS NOT NULL OR te.user_id IS NOT NULL OR tp.user_id IS NOT NULL OR p.user_id IS NOT NULL)
      ORDER BY COALESCE(a.sold, 0) DESC, lower(u.name)`, [period.from, period.to]);
  return rows.map((r) => ({
    user_id: r.user_id, name: r.name, active: r.active, role_name: r.role_name,
    sold: r2(r.sold), services: r.services, sales: r.sales, average_ticket: r.sales ? r2(r.sold / r.sales) : 0,
    commission_earned: r2(r.commission_earned), paid: r2(r.paid), pending_total: r2(r.pending_total),
  }));
}

/**
 * Rankings do período (só entra quem teve ao menos um serviço fechado).
 * "Melhor desempenho" = média das posições em faturamento, serviços e vendas (menor é melhor); desempate por faturamento.
 */
function buildRanking(team) {
  const active = team.filter((t) => t.services > 0);
  const top = (key, n = 10) => active.slice().sort((a, b) => b[key] - a[key] || b.sold - a.sold || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, n).map((t) => ({ user_id: t.user_id, name: t.name, value: t[key] }));
  const pos = (key) => {
    const sorted = active.slice().sort((a, b) => b[key] - a[key]);
    return new Map(sorted.map((t) => [t.user_id, 1 + sorted.findIndex((x) => x[key] === t[key])])); // empates dividem a posição
  };
  const [ps, pv, pl] = [pos('sold'), pos('services'), pos('sales')];
  const overall = active.map((t) => ({
    user_id: t.user_id, name: t.name, value: Math.round(((ps.get(t.user_id) + pv.get(t.user_id) + pl.get(t.user_id)) / 3) * 100) / 100, sold: t.sold,
  })).sort((a, b) => a.value - b.value || b.sold - a.sold || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 10).map(({ sold, ...r }) => r);
  return { sold: top('sold'), services: top('services'), sales: top('sales'), average_ticket: top('average_ticket'), overall };
}

module.exports = { resolvePeriod, userReport, userServices, overview, teamTable };
