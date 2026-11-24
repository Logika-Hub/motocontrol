// Regras de comissão e repasses (pagamentos) aos colaboradores (D19).
// Saldo = comissões das vendas ATIVAS − repasses ATIVOS. Nada é guardado como saldo: sempre calculado.
const { query, withTransaction } = require('../config/db');
const { audit } = require('./audit');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { toCents, fromCents } = require('../lib/saleCalc');

const PAYOUT_METHODS = { pix: 'PIX', dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro' };

// ---- Regras -------------------------------------------------------------------------------------------

async function listRules() {
  const active = (await query(
    `SELECT r.id, r.user_id, u.name AS user_name, r.type, r.value, r.created_at, cb.name AS created_by_name
       FROM commission_rules r LEFT JOIN users u ON u.id = r.user_id JOIN users cb ON cb.id = r.created_by
      WHERE r.ended_at IS NULL ORDER BY r.user_id NULLS FIRST, lower(u.name)`)).rows;
  const history = (await query(
    `SELECT r.id, r.user_id, u.name AS user_name, r.type, r.value, r.created_at, cb.name AS created_by_name, r.ended_at, eb.name AS ended_by_name
       FROM commission_rules r LEFT JOIN users u ON u.id = r.user_id JOIN users cb ON cb.id = r.created_by LEFT JOIN users eb ON eb.id = r.ended_by
      WHERE r.ended_at IS NOT NULL ORDER BY r.ended_at DESC, r.id DESC LIMIT 50`)).rows;
  return { default: active.find((r) => r.user_id === null) || null, items: active.filter((r) => r.user_id !== null), history };
}

/** Define (ou substitui) a regra de um colaborador, ou a padrão quando userId é nulo. A anterior é encerrada, não editada. */
async function setRule(user, { userId, type, value }, ip) {
  if (!['percentual', 'fixo'].includes(type)) throw badRequest('Tipo de comissão inválido (percentual ou fixo).');
  const cents = toCents(value, 'valor da comissão');
  if (cents < 0) throw badRequest('O valor da comissão não pode ser negativo.');
  if (type === 'percentual' && cents > 10000) throw badRequest('O percentual não pode passar de 100%.');
  const v = fromCents(cents);
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(727002)');
    if (userId !== null) {
      const { rows: [u] } = await db.query(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND u.active AND r.code <> 'consulta'`, [userId]);
      if (!u) throw badRequest('Colaborador não encontrado ou inativo.');
    }
    const { rows: [cur] } = await db.query(
      'SELECT id, type, value FROM commission_rules WHERE COALESCE(user_id, 0) = $1 AND ended_at IS NULL', [userId || 0]);
    if (cur && cur.type === type && cur.value === v) return cur.id;
    if (cur) await db.query('UPDATE commission_rules SET ended_at = now(), ended_by = $2 WHERE id = $1', [cur.id, user.id]);
    const { rows: [rule] } = await db.query(
      'INSERT INTO commission_rules (user_id, type, value, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [userId, type, v, user.id]);
    await audit(db, { userId: user.id, action: 'definir_comissao', entity: 'commission_rules', entityId: rule.id,
      details: { targetUserId: userId, type, value: v, replaced: cur ? { type: cur.type, value: cur.value } : null }, ip });
    return rule.id;
  });
}

/** Encerra uma regra. Volta a valer a padrão (se houver); vendas já fechadas não mudam. */
async function endRule(user, ruleId, ip) {
  return withTransaction(async (db) => {
    const { rows: [r] } = await db.query(
      'UPDATE commission_rules SET ended_at = now(), ended_by = $2 WHERE id = $1 AND ended_at IS NULL RETURNING id, user_id, type, value', [ruleId, user.id]);
    if (!r) throw notFound('Regra não encontrada ou já encerrada.');
    await audit(db, { userId: user.id, action: 'encerrar_comissao', entity: 'commission_rules', entityId: r.id,
      details: { targetUserId: r.user_id, type: r.type, value: r.value }, ip });
  });
}

// ---- Saldos e repasses --------------------------------------------------------------------------------

/** Total ganho, pago e a pagar de cada colaborador (histórico completo). */
async function balances() {
  const { rows } = await query(
    `SELECT u.id AS user_id, u.name, u.active, r.name AS role_name,
            COALESCE(e.earned, 0) AS earned, COALESCE(p.paid, 0) AS paid,
            COALESCE(e.earned, 0) - COALESCE(p.paid, 0) AS pending, p.last_paid_at
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN (SELECT si.user_id, sum(si.commission_amount) AS earned
                    FROM sale_items si JOIN sales s ON s.id = si.sale_id
                   WHERE s.status = 'concluida' AND si.user_id IS NOT NULL GROUP BY si.user_id) e ON e.user_id = u.id
       LEFT JOIN (SELECT user_id, sum(amount) AS paid, max(paid_at) AS last_paid_at
                    FROM commission_payouts WHERE status = 'ativo' GROUP BY user_id) p ON p.user_id = u.id
      WHERE r.code <> 'consulta' AND (u.active OR e.earned IS NOT NULL OR p.paid IS NOT NULL)
      ORDER BY (COALESCE(e.earned, 0) - COALESCE(p.paid, 0)) DESC, lower(u.name)`);
  return rows;
}

async function createPayout(user, { userId, amount, method, note }, ip) {
  if (!PAYOUT_METHODS[method]) throw badRequest('Forma de pagamento inválida.');
  const cents = toCents(amount, 'valor do repasse');
  if (cents <= 0) throw badRequest('O valor do repasse deve ser maior que zero.');
  return withTransaction(async (db) => {
    // Bloqueia o colaborador: dois repasses simultâneos não conseguem ultrapassar o saldo.
    const { rows: [u] } = await db.query(
      `SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1 AND r.code <> 'consulta' FOR UPDATE OF u`, [userId]);
    if (!u) throw badRequest('Colaborador não encontrado.');
    const { rows: [b] } = await db.query(
      `SELECT (SELECT COALESCE(sum(si.commission_amount), 0) FROM sale_items si JOIN sales s ON s.id = si.sale_id
                WHERE s.status = 'concluida' AND si.user_id = $1)
            - (SELECT COALESCE(sum(amount), 0) FROM commission_payouts WHERE user_id = $1 AND status = 'ativo') AS pending`, [userId]);
    const pendingCents = Math.round(b.pending * 100);
    if (cents > pendingCents) {
      throw conflict(`O valor excede o saldo pendente de ${u.name} (R$ ${fromCents(Math.max(pendingCents, 0)).toFixed(2).replace('.', ',')}).`,
        { pending: fromCents(pendingCents) });
    }
    const { rows: [p] } = await db.query(
      `INSERT INTO commission_payouts (user_id, amount, method, note, paid_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [userId, fromCents(cents), method, note || null, user.id]);
    await audit(db, { userId: user.id, action: 'registrar_repasse', entity: 'commission_payouts', entityId: p.id,
      details: { targetUserId: userId, amount: fromCents(cents), method, pendingBefore: fromCents(pendingCents), partial: cents < pendingCents }, ip });
    return p.id;
  });
}

/** Cancelamento de repasse lançado errado: o registro fica, marcado e com motivo; o valor volta ao saldo pendente. */
async function cancelPayout(user, payoutId, { reason }, ip) {
  if (!reason) throw badRequest('Informe o motivo do cancelamento.');
  return withTransaction(async (db) => {
    const { rows: [p] } = await db.query('SELECT * FROM commission_payouts WHERE id = $1 FOR UPDATE', [payoutId]);
    if (!p) throw notFound('Repasse não encontrado.');
    if (p.status !== 'ativo') throw conflict('Este repasse já foi cancelado.');
    await db.query(`UPDATE commission_payouts SET status = 'cancelado', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`,
      [payoutId, user.id, reason]);
    await audit(db, { userId: user.id, action: 'cancelar_repasse', entity: 'commission_payouts', entityId: payoutId,
      details: { targetUserId: p.user_id, amount: p.amount, reason }, ip });
  });
}

async function listPayouts({ userId, from, to }, { limit, offset }) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (userId) add('p.user_id = ?', userId);
  if (from) add('p.paid_at >= ?::date', from);
  if (to) add('p.paid_at < (?::date + 1)', to);
  const { rows } = await query(
    `SELECT p.id, p.user_id, u.name AS user_name, p.amount, p.method, p.note, p.status, p.paid_at, pb.name AS paid_by_name,
            p.cancelled_at, cb.name AS cancelled_by_name, p.cancel_reason, count(*) OVER()::int AS total_rows
       FROM commission_payouts p JOIN users u ON u.id = p.user_id JOIN users pb ON pb.id = p.paid_by LEFT JOIN users cb ON cb.id = p.cancelled_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.paid_at DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  return { total: rows[0] ? rows[0].total_rows : 0, items: rows.map(({ total_rows, ...r }) => ({ ...r, method_label: PAYOUT_METHODS[r.method] })) };
}

module.exports = { PAYOUT_METHODS, listRules, setRule, endRule, balances, createPayout, cancelPayout, listPayouts };
