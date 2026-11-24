// Fechamento de comandas em vendas (D19). Todo valor é calculado aqui (server/lib/saleCalc.js).
const { query, withTransaction } = require('../config/db');
const { audit } = require('./audit');
const { badRequest, notFound, conflict } = require('../lib/errors');
const calc = require('../lib/saleCalc');
const workOrders = require('./workOrders');

const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`;

/** Regras de comissão vigentes: uma por colaborador e a padrão (user_id nulo). */
async function loadRules(db) {
  const { rows } = await db.query('SELECT user_id, type, value FROM commission_rules WHERE ended_at IS NULL');
  const byUser = new Map();
  let fallback = null;
  for (const r of rows) {
    if (r.user_id === null) fallback = { type: r.type, value: r.value };
    else byUser.set(r.user_id, { type: r.type, value: r.value });
  }
  return { byUser, fallback };
}

/** Quem pode ser responsável por um serviço: funcionários ativos que não são só de consulta. */
async function loadCollaborators(db) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.active AND r.code <> 'consulta' ORDER BY lower(u.name)`);
  return rows;
}

async function activeSaleOf(db, workOrderId) {
  const { rows: [s] } = await db.query(`SELECT id FROM sales WHERE work_order_id = $1 AND status = 'concluida'`, [workOrderId]);
  return s || null;
}

/** Só comandas concluídas e ainda sem venda ativa podem ser fechadas. */
async function assertClosable(db, wo) {
  if (wo.status === 'cancelada') throw conflict('Comanda cancelada não gera venda.');
  if (wo.status !== 'concluida') throw conflict('Conclua a comanda antes de fechar a venda.');
  const sale = await activeSaleOf(db, wo.id);
  if (sale) throw conflict(`Esta comanda já foi fechada (venda #${sale.id}).`, { saleId: sale.id });
}

async function closingData(workOrderId) {
  const { rows: [wo] } = await query(
    `SELECT w.id, w.number, w.status, w.closed_at, c.name AS customer_name, m.brand, m.model, m.plate
       FROM work_orders w JOIN customers c ON c.id = w.customer_id JOIN motorcycles m ON m.id = w.motorcycle_id
      WHERE w.id = $1`, [workOrderId]);
  if (!wo) throw notFound('Comanda não encontrada.');
  await assertClosable({ query }, wo);
  const items = (await query(
    `SELECT i.id, i.kind, i.description, i.quantity, i.unit_price, i.performed_by, up.name AS performed_by_name
       FROM work_order_items i LEFT JOIN users up ON up.id = i.performed_by
      WHERE i.work_order_id = $1 AND i.removed_at IS NULL ORDER BY i.id`, [workOrderId])).rows;
  return {
    work_order: { ...wo, code: workOrders.formatNumber(wo.number) },
    items, collaborators: await loadCollaborators({ query }),
    payment_methods: Object.entries(calc.PAYMENT_METHODS).map(([code, label]) => ({ code, label })),
  };
}

/** Valida o corpo do fechamento contra os itens reais da comanda e calcula tudo. */
async function buildCalculation(db, workOrderId, body) {
  const stored = (await db.query(
    `SELECT id, kind, description, quantity, unit_price, performed_by FROM work_order_items
      WHERE work_order_id = $1 AND removed_at IS NULL ORDER BY id`, [workOrderId])).rows;
  const sent = new Map();
  for (const e of Array.isArray(body.items) ? body.items : []) {
    if (!e || !Number.isInteger(Number(e.itemId))) throw badRequest('Item inválido no fechamento.');
    sent.set(Number(e.itemId), e);
  }
  for (const id of sent.keys()) if (!stored.some((s) => s.id === id)) throw badRequest('O fechamento contém um item que não pertence à comanda.');

  const collaborators = await loadCollaborators(db);
  const ids = new Set(collaborators.map((c) => c.id));
  const items = stored.map((s) => {
    const e = sent.get(s.id) || {};
    let priceCents;
    if (e.unitPrice !== undefined && e.unitPrice !== null && e.unitPrice !== '') priceCents = calc.toCents(e.unitPrice, `preço de "${s.description}"`);
    else if (s.unit_price !== null) priceCents = calc.toCents(s.unit_price);
    else throw badRequest(`Informe o preço de "${s.description}".`);
    if (priceCents < 0) throw badRequest(`O preço de "${s.description}" não pode ser negativo.`);
    let userId = null;
    if (s.kind === 'servico') {
      userId = e.userId !== undefined && e.userId !== null && e.userId !== '' ? Number(e.userId) : s.performed_by;
      if (!userId) throw badRequest(`Informe o colaborador responsável por "${s.description}".`);
      if (!ids.has(userId)) throw badRequest(`O responsável por "${s.description}" não é um colaborador ativo.`);
    }
    return { id: s.id, kind: s.kind, description: s.description, quantity: s.quantity, unitPriceCents: priceCents, userId };
  });
  const discountCents = body.discount === undefined || body.discount === null || body.discount === '' ? 0 : calc.toCents(body.discount, 'desconto');
  const result = calc.computeSale({ items, discountCents, rules: await loadRules(db) });
  return { ...result, collaborators };
}

function serialize(result, { withCommissions }) {
  const names = new Map(result.collaborators.map((c) => [c.id, c.name]));
  const perUser = new Map();
  for (const i of result.items) {
    if (!i.userId) continue;
    const p = perUser.get(i.userId) || { user_id: i.userId, name: names.get(i.userId), services: 0, amount: 0, commission: 0 };
    p.services += 1; p.amount += i.netCents; p.commission += i.commissionCents;
    perUser.set(i.userId, p);
  }
  const out = {
    subtotal: calc.fromCents(result.subtotalCents), discount: calc.fromCents(result.discountCents), total: calc.fromCents(result.totalCents),
    items: result.items.map((i) => ({
      item_id: i.id, kind: i.kind, description: i.description, quantity: i.quantity, unit_price: calc.fromCents(i.unitPriceCents),
      gross: calc.fromCents(i.grossCents), discount: calc.fromCents(i.discountCents), net: calc.fromCents(i.netCents), user_id: i.userId,
      commission_type: i.commissionType, commission_value: i.commissionValue, commission: calc.fromCents(i.commissionCents),
    })),
    collaborators: [...perUser.values()].map((p) => ({ ...p, amount: calc.fromCents(p.amount), commission: calc.fromCents(p.commission) })),
    commission_total: calc.fromCents(result.items.reduce((s, i) => s + i.commissionCents, 0)),
  };
  if (!withCommissions) { // comissões só para quem administra o financeiro (D19)
    delete out.commission_total;
    out.items = out.items.map(({ commission_type, commission_value, commission, ...i }) => i);
    out.collaborators = out.collaborators.map(({ commission, ...c }) => c);
  }
  return out;
}

/** Prévia: mesma conta do fechamento, sem gravar nada. */
async function preview(workOrderId, body, { withCommissions = false } = {}) {
  const { rows: [wo] } = await query('SELECT id, status FROM work_orders WHERE id = $1', [workOrderId]);
  if (!wo) throw notFound('Comanda não encontrada.');
  await assertClosable({ query }, wo);
  const out = serialize(await buildCalculation({ query }, workOrderId, body), { withCommissions });
  if (Array.isArray(body.payments)) {
    let paid = 0;
    for (const p of body.payments) { try { paid += calc.toCents(p && p.amount); } catch { /* linha ainda em edição */ } }
    out.payments = { paid: calc.fromCents(paid), remaining: calc.fromCents(Math.round(out.total * 100) - paid) };
  }
  return out;
}

async function close(user, workOrderId, body, ip) {
  try {
    return await withTransaction(async (db) => {
      // O bloqueio da comanda serializa fechamentos simultâneos; o índice único é a rede de segurança.
      const wo = await workOrders.lockOrder(db, workOrderId, { allowFinal: true });
      await assertClosable(db, wo);
      const result = await buildCalculation(db, workOrderId, body);
      const payments = calc.validatePayments(body.payments, result.totalCents);
      const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

      const { rows: [sale] } = await db.query(
        `INSERT INTO sales (work_order_id, subtotal, discount, total, notes, closed_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [workOrderId, calc.fromCents(result.subtotalCents), calc.fromCents(result.discountCents), calc.fromCents(result.totalCents), notes, user.id]);
      for (const i of result.items) {
        await db.query(
          `INSERT INTO sale_items (sale_id, work_order_item_id, kind, description, quantity, unit_price, gross_amount, discount_amount,
                                   net_amount, user_id, commission_type, commission_value, commission_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [sale.id, i.id, i.kind, i.description, i.quantity, calc.fromCents(i.unitPriceCents), calc.fromCents(i.grossCents),
            calc.fromCents(i.discountCents), calc.fromCents(i.netCents), i.userId, i.commissionType, i.commissionValue, calc.fromCents(i.commissionCents)]);
      }
      for (const p of payments) {
        await db.query('INSERT INTO sale_payments (sale_id, method, amount) VALUES ($1,$2,$3)', [sale.id, p.method, calc.fromCents(p.cents)]);
      }
      const methods = payments.map((p) => `${calc.PAYMENT_METHODS[p.method]} ${brl(calc.fromCents(p.cents))}`).join(', ');
      await workOrders.addUpdate(db, workOrderId, user.id, 'venda',
        `Venda #${sale.id} fechada: ${brl(calc.fromCents(result.totalCents))}${result.discountCents ? ` (desconto ${brl(calc.fromCents(result.discountCents))})` : ''}. Pagamento: ${methods}.`,
        { metadata: { saleId: sale.id, action: 'fechamento' } });
      await audit(db, { userId: user.id, action: 'fechar_venda', entity: 'sales', entityId: sale.id,
        details: { workOrderId, total: calc.fromCents(result.totalCents), discount: calc.fromCents(result.discountCents),
          payments: payments.map((p) => ({ method: p.method, amount: calc.fromCents(p.cents) })),
          commissions: result.items.filter((i) => i.commissionCents).map((i) => ({ userId: i.userId, amount: calc.fromCents(i.commissionCents) })) }, ip });
      return sale.id;
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'sales_one_active_per_order_uq') throw conflict('Esta comanda já foi fechada por outro usuário.');
    throw err;
  }
}

/** Estorno (só administrador): a venda continua no histórico, marcada, e deixa de contar nos totais e nas comissões. */
async function voidSale(user, saleId, { reason }, ip) {
  if (!reason) throw badRequest('Informe o motivo do estorno.');
  return withTransaction(async (db) => {
    const { rows: [s0] } = await db.query('SELECT work_order_id FROM sales WHERE id = $1', [saleId]);
    if (!s0) throw notFound('Venda não encontrada.');
    await db.query('SELECT id FROM work_orders WHERE id = $1 FOR UPDATE', [s0.work_order_id]); // mesma ordem de bloqueio do fechamento
    const { rows: [sale] } = await db.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [saleId]);
    if (sale.status !== 'concluida') throw conflict('Esta venda já foi estornada.');
    await db.query(`UPDATE sales SET status = 'estornada', voided_by = $2, voided_at = now(), void_reason = $3 WHERE id = $1`, [saleId, user.id, reason]);
    await workOrders.addUpdate(db, sale.work_order_id, user.id, 'venda',
      `Venda #${saleId} estornada (${brl(sale.total)}). Motivo: ${reason}`, { metadata: { saleId, action: 'estorno' } });
    await audit(db, { userId: user.id, action: 'estornar_venda', entity: 'sales', entityId: saleId, details: { reason, total: sale.total, workOrderId: sale.work_order_id }, ip });
  });
}

/** Detalhe da venda. As comissões só aparecem para quem administra o financeiro. */
async function getSale(id, { withCommissions }) {
  const { rows: [s] } = await query(
    `SELECT s.*, w.number, w.status AS work_order_status, c.name AS customer_name, m.brand, m.model, m.plate,
            uc.name AS closed_by_name, uv.name AS voided_by_name
       FROM sales s JOIN work_orders w ON w.id = s.work_order_id JOIN customers c ON c.id = w.customer_id
       JOIN motorcycles m ON m.id = w.motorcycle_id JOIN users uc ON uc.id = s.closed_by LEFT JOIN users uv ON uv.id = s.voided_by
      WHERE s.id = $1`, [id]);
  if (!s) throw notFound('Venda não encontrada.');
  const items = (await query(
    `SELECT si.*, u.name AS user_name FROM sale_items si LEFT JOIN users u ON u.id = si.user_id WHERE si.sale_id = $1 ORDER BY si.id`, [id])).rows
    .map((i) => (withCommissions ? i : { ...i, commission_type: null, commission_value: null, commission_amount: undefined }));
  const payments = (await query('SELECT id, method, amount FROM sale_payments WHERE sale_id = $1 ORDER BY id', [id])).rows
    .map((p) => ({ ...p, method_label: calc.PAYMENT_METHODS[p.method] }));
  return { ...s, code: workOrders.formatNumber(s.number), items, payments };
}

async function list(filters, { limit, offset }) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (filters.from) where.push(`s.closed_at >= ${p(filters.from)}::date`);
  if (filters.to) where.push(`s.closed_at < (${p(filters.to)}::date + 1)`);
  if (filters.status && ['concluida', 'estornada'].includes(filters.status)) where.push(`s.status = ${p(filters.status)}`);
  if (filters.userId) where.push(`EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id AND x.user_id = ${p(Number(filters.userId))})`);
  if (filters.method && calc.PAYMENT_METHODS[filters.method]) where.push(`EXISTS (SELECT 1 FROM sale_payments x WHERE x.sale_id = s.id AND x.method = ${p(filters.method)})`);
  if (filters.q) {
    const n = workOrders.parseNumber(filters.q);
    const like = p(`%${filters.q.toLowerCase().replace(/[^a-z0-9à-ú ]/gi, '')}%`);
    where.push(`(${n !== null ? `w.number = ${p(n)} OR ` : ''}lower(m.plate) LIKE ${like} OR lower(c.name) LIKE ${like})`);
  }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM sales s JOIN work_orders w ON w.id = s.work_order_id JOIN customers c ON c.id = w.customer_id
                JOIN motorcycles m ON m.id = w.motorcycle_id JOIN users uc ON uc.id = s.closed_by ${W}`;
  const { rows } = await query(
    `SELECT s.id, s.work_order_id, w.number, s.status, s.subtotal, s.discount, s.total, s.closed_at, uc.name AS closed_by_name,
            c.name AS customer_name, m.brand, m.model, m.plate,
            (SELECT string_agg(DISTINCT u.name, ', ' ORDER BY u.name) FROM sale_items x JOIN users u ON u.id = x.user_id WHERE x.sale_id = s.id) AS collaborators,
            (SELECT string_agg(DISTINCT x.method, ',' ORDER BY x.method) FROM sale_payments x WHERE x.sale_id = s.id) AS methods,
            count(*) OVER()::int AS total_rows
       ${base} ORDER BY s.closed_at DESC, s.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const { rows: [sum] } = await query(
    `SELECT count(*) FILTER (WHERE s.status = 'concluida')::int AS count, COALESCE(sum(s.total) FILTER (WHERE s.status = 'concluida'), 0) AS total,
            count(*) FILTER (WHERE s.status = 'estornada')::int AS voided ${base}`, params);
  return {
    total: rows[0] ? rows[0].total_rows : 0,
    summary: sum,
    items: rows.map(({ total_rows, methods, ...r }) => ({
      ...r, code: workOrders.formatNumber(r.number),
      methods: methods ? methods.split(',').map((m) => ({ code: m, label: calc.PAYMENT_METHODS[m] })) : [],
    })),
  };
}

/** Comandas concluídas que ainda esperam o fechamento da venda. */
async function awaiting() {
  const { rows } = await query(
    `SELECT w.id, w.number, w.closed_at, c.name AS customer_name, m.brand, m.model, m.plate,
            count(i.id) FILTER (WHERE i.id IS NOT NULL)::int AS items,
            COALESCE(sum(round(i.quantity * i.unit_price, 2)), 0) AS priced_total,
            count(i.id) FILTER (WHERE i.unit_price IS NULL)::int AS unpriced
       FROM work_orders w JOIN customers c ON c.id = w.customer_id JOIN motorcycles m ON m.id = w.motorcycle_id
       LEFT JOIN work_order_items i ON i.work_order_id = w.id AND i.removed_at IS NULL
      WHERE w.status = 'concluida' AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.work_order_id = w.id AND s.status = 'concluida')
      GROUP BY w.id, c.name, m.brand, m.model, m.plate ORDER BY w.closed_at DESC LIMIT 100`);
  return rows.map((r) => ({ ...r, code: workOrders.formatNumber(r.number) }));
}

module.exports = { closingData, preview, close, voidSale, getSale, list, awaiting, loadCollaborators, brl };
