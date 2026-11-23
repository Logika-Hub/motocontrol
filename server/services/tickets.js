/**
 * Chamados (chat) de uma comanda — D18.
 * O mecânico abre para o balcão (atendentes/admin); atendente/admin abre para a oficina (mecânicos).
 * Mensagens são imutáveis; encerrar exige resumo, gravado na linha do tempo da comanda.
 * Ordem de bloqueio: comanda (lockOrder) → chamado, a mesma de finish/cancel, para não haver deadlock.
 */
const { query, withTransaction } = require('../config/db');
const { audit } = require('./audit');
const wo = require('./workOrders');
const { badRequest, notFound, conflict } = require('../lib/errors');

const MAX_BODY = 2000;
const MAX_SUMMARY = 1000;

/** Lado da oficina a que o usuário pertence (quem ele atende na fila). */
const sideOf = (user) => (user.role === 'mecanico' ? 'oficina' : 'balcao');
/** Destino de um chamado aberto por este usuário. */
const targetFor = (user) => (user.role === 'mecanico' ? 'balcao' : 'oficina');
const TARGET_LABEL = { balcao: 'Balcão', oficina: 'Oficina' };

function text(v, field, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw badRequest(`Informe ${field}.`);
  if (s.length > max) throw badRequest(`O texto deve ter no máximo ${max} caracteres.`);
  return s;
}

async function markReadTx(db, ticketId, userId, messageId) {
  await db.query(
    `INSERT INTO work_order_ticket_reads (ticket_id, user_id, last_read_message_id) VALUES ($1,$2,$3)
     ON CONFLICT (ticket_id, user_id) DO UPDATE
       SET last_read_message_id = GREATEST(work_order_ticket_reads.last_read_message_id, EXCLUDED.last_read_message_id),
           updated_at = now()`, [ticketId, userId, messageId]);
}

async function insertMessage(db, ticketId, userId, body) {
  const { rows: [m] } = await db.query(
    'INSERT INTO work_order_ticket_messages (ticket_id, user_id, body) VALUES ($1,$2,$3) RETURNING id', [ticketId, userId, body]);
  await markReadTx(db, ticketId, userId, m.id);
  return m.id;
}

async function lockTicket(db, ticketId) {
  const { rows: [t] } = await db.query('SELECT * FROM work_order_tickets WHERE id = $1', [ticketId]);
  if (!t) throw notFound('Chamado não encontrado.');
  const order = await wo.lockOrder(db, t.work_order_id);
  const { rows: [locked] } = await db.query('SELECT * FROM work_order_tickets WHERE id = $1 FOR UPDATE', [ticketId]);
  if (locked.status !== 'aberto') throw conflict('Este chamado já foi encerrado.');
  return { ticket: locked, order };
}

async function open(user, workOrderId, { body }, ip) {
  const msg = text(body, 'a mensagem', MAX_BODY);
  return withTransaction(async (db) => {
    await wo.lockOrder(db, workOrderId); // só comandas em andamento
    const target = targetFor(user);
    const { rows: [t] } = await db.query(
      'INSERT INTO work_order_tickets (work_order_id, opened_by, target) VALUES ($1,$2,$3) RETURNING id',
      [workOrderId, user.id, target]);
    await insertMessage(db, t.id, user.id, msg);
    await audit(db, { userId: user.id, action: 'abrir_chamado', entity: 'work_order_tickets', entityId: t.id, details: { workOrderId, target }, ip });
    return t.id;
  });
}

async function addMessage(user, ticketId, { body }, ip) {
  const msg = text(body, 'a mensagem', MAX_BODY);
  return withTransaction(async (db) => {
    const { ticket } = await lockTicket(db, ticketId);
    const id = await insertMessage(db, ticket.id, user.id, msg);
    await audit(db, { userId: user.id, action: 'responder_chamado', entity: 'work_order_tickets', entityId: ticket.id, details: { messageId: id }, ip });
    return id;
  });
}

function timelineText(ticket, openerName, summary, auto) {
  const head = `Chamado #${ticket.id} (aberto por ${openerName} para ${TARGET_LABEL[ticket.target].toLowerCase()})`;
  return auto ? `${head} encerrado automaticamente. ${summary}` : `${head} encerrado. Resumo: ${summary}`;
}

async function closeTx(db, user, ticket, summary, { auto = false } = {}) {
  await db.query(
    `UPDATE work_order_tickets SET status = 'encerrado', closed_by = $2, closed_at = now(), summary = $3, auto_closed = $4
      WHERE id = $1`, [ticket.id, user.id, summary, auto]);
  const { rows: [opener] } = await db.query('SELECT name FROM users WHERE id = $1', [ticket.opened_by]);
  await wo.addUpdate(db, ticket.work_order_id, user.id, 'chamado', timelineText(ticket, opener.name, summary, auto),
    { metadata: { ticketId: ticket.id, autoClosed: auto } });
}

async function close(user, ticketId, { summary }, ip) {
  const s = text(summary, 'o resumo da conversa', MAX_SUMMARY);
  return withTransaction(async (db) => {
    const { ticket } = await lockTicket(db, ticketId);
    await closeTx(db, user, ticket, s);
    await audit(db, { userId: user.id, action: 'encerrar_chamado', entity: 'work_order_tickets', entityId: ticket.id, ip });
  });
}

/**
 * Chamado aberto não pode ficar pendurado em comanda finalizada: encerra dentro da transação
 * de finish/cancel (a comanda já está bloqueada por quem chama).
 */
async function autoCloseForOrder(db, user, workOrderId, reason, ip) {
  const { rows } = await db.query(
    `SELECT * FROM work_order_tickets WHERE work_order_id = $1 AND status = 'aberto' ORDER BY id FOR UPDATE`, [workOrderId]);
  for (const t of rows) {
    await closeTx(db, user, t, reason, { auto: true });
    await audit(db, { userId: user.id, action: 'encerrar_chamado', entity: 'work_order_tickets', entityId: t.id, details: { auto: true }, ip });
  }
}

async function markRead(user, ticketId) {
  const { rows: [t] } = await query(
    `SELECT t.id, (SELECT max(id) FROM work_order_ticket_messages m WHERE m.ticket_id = t.id) AS last
       FROM work_order_tickets t WHERE t.id = $1`, [ticketId]);
  if (!t) throw notFound('Chamado não encontrado.');
  if (t.last) await markReadTx({ query }, t.id, user.id, t.last);
}

// --- Consultas -----------------------------------------------------------------------------------

/** Campos de lista comuns; $1 = id do usuário. */
const LIST_SELECT = `
  SELECT t.id, t.work_order_id, t.target, t.status, t.summary, t.auto_closed, t.created_at, t.closed_at,
         t.opened_by, uo.name AS opened_by_name, ro.name AS opened_by_role, uc.name AS closed_by_name,
         w.number, w.status AS work_order_status, m.plate, m.brand, m.model,
         lm.body AS last_body, lm.created_at AS last_at, lu.name AS last_user_name,
         (SELECT count(*)::int FROM work_order_ticket_messages x
           WHERE x.ticket_id = t.id AND x.user_id <> $1
             AND x.id > COALESCE((SELECT r.last_read_message_id FROM work_order_ticket_reads r
                                   WHERE r.ticket_id = t.id AND r.user_id = $1), 0)) AS unread
    FROM work_order_tickets t
    JOIN work_orders w ON w.id = t.work_order_id
    JOIN motorcycles m ON m.id = w.motorcycle_id
    JOIN users uo ON uo.id = t.opened_by
    JOIN roles ro ON ro.id = uo.role_id
    LEFT JOIN users uc ON uc.id = t.closed_by
    LEFT JOIN LATERAL (SELECT body, created_at, user_id FROM work_order_ticket_messages
                        WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) lm ON TRUE
    LEFT JOIN users lu ON lu.id = lm.user_id`;

/** Chamados que dizem respeito ao usuário: os da fila do seu lado, os que abriu e os em que escreveu. $1 = usuário, $2 = lado. */
const INVOLVED = `(t.target = $2 OR t.opened_by = $1
  OR EXISTS (SELECT 1 FROM work_order_ticket_messages y WHERE y.ticket_id = t.id AND y.user_id = $1))`;

const decorate = (r) => ({ ...r, code: wo.formatNumber(r.number), target_label: TARGET_LABEL[r.target] });

async function list(user, { status = 'aberto', limit, offset }) {
  const where = [INVOLVED];
  if (status === 'aberto' || status === 'encerrado') where.push(`t.status = '${status}'`); // valores fixos, não vêm do usuário
  const params = [user.id, sideOf(user)];
  const { rows } = await query(
    `${LIST_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY (t.status = 'aberto') DESC, COALESCE(lm.created_at, t.created_at) DESC
      LIMIT $3 OFFSET $4`, [...params, limit, offset]);
  return rows.map(decorate);
}

async function summary(user) {
  const { rows: [s] } = await query(
    `SELECT count(*)::int AS open,
            count(*) FILTER (WHERE q.unread > 0)::int AS unread_tickets,
            COALESCE(sum(q.unread), 0)::int AS unread
       FROM (${LIST_SELECT} WHERE t.status = 'aberto' AND ${INVOLVED}) q`, [user.id, sideOf(user)]);
  return s;
}

async function messagesOf(ticketIds) {
  if (!ticketIds.length) return {};
  const { rows } = await query(
    `SELECT m.id, m.ticket_id, m.body, m.created_at, m.user_id, u.name AS user_name, r.name AS user_role
       FROM work_order_ticket_messages m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = u.role_id
      WHERE m.ticket_id = ANY($1::int[]) ORDER BY m.id`, [ticketIds]);
  const by = {};
  for (const m of rows) (by[m.ticket_id] ||= []).push(m);
  return by;
}

async function listForOrder(user, workOrderId) {
  const { rows: [exists] } = await query('SELECT id FROM work_orders WHERE id = $1', [workOrderId]);
  if (!exists) throw notFound('Comanda não encontrada.');
  const { rows } = await query(`${LIST_SELECT} WHERE t.work_order_id = $2 ORDER BY t.id`, [user.id, workOrderId]);
  const msgs = await messagesOf(rows.map((r) => r.id));
  return rows.map((r) => ({ ...decorate(r), messages: msgs[r.id] || [] }));
}

async function getDetail(user, ticketId) {
  const { rows: [t] } = await query(`${LIST_SELECT} WHERE t.id = $2`, [user.id, ticketId]);
  if (!t) throw notFound('Chamado não encontrado.');
  const msgs = await messagesOf([t.id]);
  return { ...decorate(t), messages: msgs[t.id] || [] };
}

module.exports = { open, addMessage, close, autoCloseForOrder, markRead, list, summary, listForOrder, getDetail, sideOf, targetFor };
