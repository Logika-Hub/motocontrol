const { query, withTransaction } = require('../config/db');
const { audit } = require('./audit');
const { can } = require('../config/permissions');
const { badRequest, notFound, conflict, forbidden } = require('../lib/errors');

const STATUS = {
  aberta: 'Aberta',
  em_diagnostico: 'Em diagnóstico',
  aguardando_pecas: 'Aguardando peças',
  em_execucao: 'Em execução',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
const ACTIVE_STATUSES = ['aberta', 'em_diagnostico', 'aguardando_pecas', 'em_execucao'];
const FINAL_STATUSES = ['concluida', 'cancelada'];

const formatNumber = (n) => `OS-${String(n).padStart(6, '0')}`;

/** Aceita "OS-000124", "os124" ou "124". */
function parseNumber(v) {
  const m = String(v || '').toUpperCase().match(/^(?:OS-?)?0*(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}

// Campos editáveis e a permissão exigida para cada um.
const EDITABLE_FIELDS = {
  complaint:          { column: 'complaint',           perm: 'work_orders:edit_reception', label: 'Reclamação do cliente' },
  entryKm:            { column: 'entry_km',            perm: 'work_orders:edit_reception', label: 'Km na entrada' },
  expectedDelivery:   { column: 'expected_delivery',   perm: 'work_orders:edit_reception', label: 'Previsão de entrega' },
  identifiedProblems: { column: 'identified_problems', perm: 'work_orders:edit_technical', label: 'Problemas identificados' },
  diagnosis:          { column: 'diagnosis',           perm: 'work_orders:edit_technical', label: 'Diagnóstico' },
  notes:              { column: 'notes',               perm: ['work_orders:edit_reception', 'work_orders:edit_technical'], label: 'Observações' },
};

// Tipos de registro manual na linha do tempo e a permissão exigida.
const MANUAL_UPDATE_TYPES = {
  observacao:  'work_orders:note',
  diagnostico: 'work_orders:diagnosis',
  servico:     'work_orders:diagnosis',
};

function hasAny(user, perm) {
  return (Array.isArray(perm) ? perm : [perm]).some((p) => can(user.role, p));
}

async function addUpdate(db, workOrderId, userId, type, description, extra = {}) {
  const { rows: [u] } = await db.query(
    `INSERT INTO work_order_updates (work_order_id, user_id, type, description, from_status, to_status, corrects_update_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [workOrderId, userId, type, description, extra.fromStatus || null, extra.toStatus || null,
      extra.correctsUpdateId || null, extra.metadata ? JSON.stringify(extra.metadata) : null],
  );
  return u.id;
}

/**
 * Bloqueia a comanda (SELECT ... FOR UPDATE) e valida a versão esperada (RN12).
 * Retorna a linha atual.
 */
async function lockOrder(db, id, { expectedVersion, allowFinal = false } = {}) {
  const { rows: [wo] } = await db.query('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [id]);
  if (!wo) throw notFound('Comanda não encontrada.');
  if (!allowFinal && FINAL_STATUSES.includes(wo.status)) {
    throw conflict(`A comanda está ${STATUS[wo.status].toLowerCase()} e não pode mais ser alterada.`);
  }
  if (expectedVersion !== undefined) {
    if (!Number.isInteger(Number(expectedVersion))) throw badRequest('Informe a versão da comanda (campo "version").');
    if (Number(expectedVersion) !== wo.version) {
      throw conflict('A comanda foi alterada por outro usuário. Recarregue para ver as alterações mais recentes.', {
        currentVersion: wo.version,
      });
    }
  }
  return wo;
}

async function create(user, data, ip) {
  return withTransaction(async (db) => {
    const { rows: [moto] } = await db.query(
      'SELECT id, customer_id, current_km FROM motorcycles WHERE id = $1 AND deleted_at IS NULL', [data.motorcycleId]);
    if (!moto) throw badRequest('Motocicleta não encontrada.');
    const customerId = data.customerId || moto.customer_id;
    if (customerId !== moto.customer_id) throw badRequest('A motocicleta informada não pertence a este cliente.');

    const { rows: [open] } = await db.query(
      `SELECT number FROM work_orders WHERE motorcycle_id = $1 AND status = ANY($2) LIMIT 1`, [moto.id, ACTIVE_STATUSES]);
    if (open) throw conflict(`Esta motocicleta já possui a comanda ${formatNumber(open.number)} em andamento.`, { number: open.number });

    const { rows: [wo] } = await db.query(
      `INSERT INTO work_orders (customer_id, motorcycle_id, entry_km, complaint, notes, expected_delivery, opened_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [customerId, moto.id, data.entryKm, data.complaint, data.notes, data.expectedDelivery, user.id],
    );
    if (data.entryKm !== null && (moto.current_km === null || data.entryKm > moto.current_km)) {
      await db.query('UPDATE motorcycles SET current_km = $2, updated_at = now() WHERE id = $1', [moto.id, data.entryKm]);
    }
    await addUpdate(db, wo.id, user.id, 'abertura', `Comanda criada. Reclamação do cliente: ${data.complaint}`, { toStatus: 'aberta' });
    await audit(db, { userId: user.id, action: 'criar', entity: 'work_orders', entityId: wo.id, details: { number: wo.number }, ip });
    return wo;
  });
}

async function getDetail(id) {
  const { rows: [wo] } = await query(
    `SELECT w.*, c.name AS customer_name, c.phone AS customer_phone,
            m.brand, m.model, m.year, m.plate, m.color,
            uo.name AS opened_by_name, uc.name AS closed_by_name
       FROM work_orders w
       JOIN customers c ON c.id = w.customer_id
       JOIN motorcycles m ON m.id = w.motorcycle_id
       JOIN users uo ON uo.id = w.opened_by
       LEFT JOIN users uc ON uc.id = w.closed_by
      WHERE w.id = $1`, [id]);
  if (!wo) throw notFound('Comanda não encontrada.');
  const items = (await query(
    `SELECT i.*, uc.name AS created_by_name, up.name AS performed_by_name
       FROM work_order_items i
       JOIN users uc ON uc.id = i.created_by
       LEFT JOIN users up ON up.id = i.performed_by
      WHERE i.work_order_id = $1 AND i.removed_at IS NULL ORDER BY i.id`, [id])).rows;
  const updates = (await query(
    `SELECT u.id, u.type, u.description, u.from_status, u.to_status, u.corrects_update_id, u.metadata, u.created_at,
            u.removed_at, u.removed_reason, u.user_id, us.name AS user_name, r.name AS user_role,
            ur.name AS removed_by_name,
            EXISTS (SELECT 1 FROM work_order_updates x WHERE x.corrects_update_id = u.id AND x.removed_at IS NULL) AS corrected
       FROM work_order_updates u
       JOIN users us ON us.id = u.user_id
       JOIN roles r ON r.id = us.role_id
       LEFT JOIN users ur ON ur.id = u.removed_by
      WHERE u.work_order_id = $1 ORDER BY u.created_at, u.id`, [id])).rows;
  // Venda ativa (D19), se a comanda já foi fechada.
  const { rows: [sale] } = await query(
    `SELECT s.id, s.total, s.discount, s.closed_at, u.name AS closed_by_name
       FROM sales s JOIN users u ON u.id = s.closed_by WHERE s.work_order_id = $1 AND s.status = 'concluida'`, [id]);
  return { ...wo, code: formatNumber(wo.number), status_label: STATUS[wo.status], items, updates, sale: sale || null };
}

async function search(filters, { limit, offset }) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (filters.number) {
    const n = parseNumber(filters.number);
    if (n === null) throw badRequest('Número de comanda inválido.');
    where.push(`w.number = ${p(n)}`);
  }
  if (filters.plate) where.push(`m.plate LIKE ${p(`%${filters.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`)}`);
  if (filters.customer) where.push(`lower(c.name) LIKE ${p(`%${filters.customer.toLowerCase()}%`)}`);
  if (filters.model) where.push(`lower(m.model) LIKE ${p(`%${filters.model.toLowerCase()}%`)}`);
  if (filters.status) {
    const list = String(filters.status).split(',').filter((s) => STATUS[s]);
    if (list.length) where.push(`w.status = ANY(${p(list)})`);
  }
  if (filters.userId) {
    // "Funcionário responsável": quem abriu, encerrou ou registrou atividade na comanda.
    const u = p(Number(filters.userId));
    where.push(`(w.opened_by = ${u} OR w.closed_by = ${u} OR EXISTS
                 (SELECT 1 FROM work_order_updates x WHERE x.work_order_id = w.id AND x.user_id = ${u}))`);
  }
  if (filters.from) where.push(`w.opened_at >= ${p(filters.from)}::date`);
  if (filters.to) where.push(`w.opened_at < (${p(filters.to)}::date + 1)`);
  if (filters.motorcycleId) where.push(`w.motorcycle_id = ${p(Number(filters.motorcycleId))}`);

  const { rows } = await query(
    `SELECT w.id, w.number, w.status, w.opened_at, w.closed_at, w.expected_delivery, w.complaint,
            c.name AS customer_name, m.brand, m.model, m.plate, u.name AS opened_by_name,
            count(*) OVER()::int AS total
       FROM work_orders w
       JOIN customers c ON c.id = w.customer_id
       JOIN motorcycles m ON m.id = w.motorcycle_id
       JOIN users u ON u.id = w.opened_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY w.opened_at DESC, w.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return {
    total: rows[0] ? rows[0].total : 0,
    items: rows.map(({ total, ...r }) => ({ ...r, code: formatNumber(r.number), status_label: STATUS[r.status] })),
  };
}

async function editFields(user, id, body, ip) {
  return withTransaction(async (db) => {
    const wo = await lockOrder(db, id, { expectedVersion: body.version });
    const sets = [];
    const params = [id];
    const changes = [];
    for (const [key, def] of Object.entries(EDITABLE_FIELDS)) {
      if (body[key] === undefined) continue;
      if (!hasAny(user, def.perm)) throw forbidden(`Você não tem permissão para alterar o campo "${def.label}".`);
      const value = body[key];
      if (String(wo[def.column] ?? '') === String(value ?? '')) continue;
      if (key === 'complaint' && !value) throw badRequest('A reclamação do cliente é obrigatória.');
      params.push(value);
      sets.push(`${def.column} = $${params.length}`);
      changes.push({ field: key, label: def.label, from: wo[def.column], to: value });
    }
    if (!changes.length) return wo;
    const { rows: [updated] } = await db.query(
      `UPDATE work_orders SET ${sets.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, params);

    // Edições ficam no histórico com valor anterior e novo (correções preservam o histórico).
    const diagnosisChange = changes.find((c) => c.field === 'diagnosis');
    const description = changes.map((c) => `${c.label}: ${c.to === null || c.to === '' ? '(vazio)' : c.to}`).join(' | ');
    await addUpdate(db, id, user.id, diagnosisChange && changes.length === 1 ? 'diagnostico' : 'edicao',
      diagnosisChange && changes.length === 1 ? `Diagnóstico: ${diagnosisChange.to}` : `Campos atualizados — ${description}`,
      { metadata: { changes } });
    await audit(db, { userId: user.id, action: 'editar', entity: 'work_orders', entityId: id, details: { changes }, ip });
    return updated;
  });
}

async function changeStatus(user, id, { status, version, note }, ip) {
  if (!ACTIVE_STATUSES.includes(status)) {
    throw badRequest('Status inválido. Para concluir ou cancelar, use as ações próprias.');
  }
  return withTransaction(async (db) => {
    const wo = await lockOrder(db, id, { expectedVersion: version });
    if (wo.status === status) throw badRequest('A comanda já está neste status.');
    const { rows: [updated] } = await db.query(
      'UPDATE work_orders SET status = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *', [id, status]);
    const text = `Status alterado de "${STATUS[wo.status]}" para "${STATUS[status]}".${note ? ` ${note}` : ''}`;
    await addUpdate(db, id, user.id, 'status', text, { fromStatus: wo.status, toStatus: status });
    await audit(db, { userId: user.id, action: 'alterar_status', entity: 'work_orders', entityId: id, details: { from: wo.status, to: status }, ip });
    return updated;
  });
}

async function finish(user, id, { version, closingNotes }, ip) {
  return withTransaction(async (db) => {
    const wo = await lockOrder(db, id, { expectedVersion: version });
    const { rows: [pending] } = await db.query(
      `SELECT count(*)::int AS n FROM work_order_items
        WHERE work_order_id = $1 AND kind = 'servico' AND status = 'solicitado' AND removed_at IS NULL`, [id]);
    if (pending.n > 0) {
      throw conflict(`Existem ${pending.n} serviço(s) ainda não marcados como realizados. Marque-os ou remova-os antes de concluir.`);
    }
    const { rows: [updated] } = await db.query(
      `UPDATE work_orders SET status = 'concluida', closed_by = $2, closed_at = now(), closing_notes = $3,
              version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, user.id, closingNotes]);
    await addUpdate(db, id, user.id, 'finalizacao', `Comanda concluída.${closingNotes ? ` ${closingNotes}` : ''}`,
      { fromStatus: wo.status, toStatus: 'concluida' });
    await audit(db, { userId: user.id, action: 'finalizar', entity: 'work_orders', entityId: id, ip });
    await require('./tickets').autoCloseForOrder(db, user, id, 'Comanda concluída.', ip); // D18
    return updated;
  });
}

async function cancel(user, id, { version, reason }, ip) {
  if (!reason) throw badRequest('Informe a justificativa do cancelamento.'); // RN11
  return withTransaction(async (db) => {
    const wo = await lockOrder(db, id, { expectedVersion: version });
    const { rows: [updated] } = await db.query(
      `UPDATE work_orders SET status = 'cancelada', closed_by = $2, closed_at = now(), cancel_reason = $3,
              version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`, [id, user.id, reason]);
    await addUpdate(db, id, user.id, 'cancelamento', `Comanda cancelada. Justificativa: ${reason}`,
      { fromStatus: wo.status, toStatus: 'cancelada' });
    await audit(db, { userId: user.id, action: 'cancelar', entity: 'work_orders', entityId: id, details: { reason }, ip });
    await require('./tickets').autoCloseForOrder(db, user, id, 'Comanda cancelada.', ip); // D18
    return updated;
  });
}

async function addManualUpdate(user, id, { type, description }, ip) {
  const perm = MANUAL_UPDATE_TYPES[type];
  if (!perm) throw badRequest('Tipo de registro inválido.');
  if (!can(user.role, perm)) throw forbidden();
  if (!description) throw badRequest('Descreva a atividade.');
  return withTransaction(async (db) => {
    await lockOrder(db, id);
    const updateId = await addUpdate(db, id, user.id, type, description);
    await audit(db, { userId: user.id, action: 'registrar_atividade', entity: 'work_orders', entityId: id, details: { updateId, type }, ip });
    return updateId;
  });
}

/** Correção: o registro original é preservado e um novo registro aponta para ele. */
async function correctUpdate(user, id, updateId, { description }, ip) {
  if (!description) throw badRequest('Informe o texto corrigido.');
  return withTransaction(async (db) => {
    await lockOrder(db, id, { allowFinal: user.role === 'admin' });
    const { rows: [orig] } = await db.query(
      'SELECT * FROM work_order_updates WHERE id = $1 AND work_order_id = $2 AND removed_at IS NULL', [updateId, id]);
    if (!orig) throw notFound('Registro não encontrado.');
    if (!Object.keys(MANUAL_UPDATE_TYPES).concat('correcao').includes(orig.type)) {
      throw badRequest('Registros automáticos do sistema não podem ser corrigidos.');
    }
    if (orig.user_id !== user.id && user.role !== 'admin') throw forbidden('Somente o autor do registro ou um administrador pode corrigi-lo.');
    const newId = await addUpdate(db, id, user.id, 'correcao', description, {
      correctsUpdateId: orig.id, metadata: { original: orig.description, originalType: orig.type },
    });
    await audit(db, { userId: user.id, action: 'corrigir_registro', entity: 'work_order_updates', entityId: orig.id, details: { newId }, ip });
    return newId;
  });
}

/** Remoção restrita e auditada: o registro é marcado, nunca apagado fisicamente. */
async function removeUpdate(user, id, updateId, { reason }, ip) {
  if (!reason) throw badRequest('Informe o motivo da remoção.');
  return withTransaction(async (db) => {
    const { rows: [orig] } = await db.query(
      'SELECT * FROM work_order_updates WHERE id = $1 AND work_order_id = $2 AND removed_at IS NULL FOR UPDATE', [updateId, id]);
    if (!orig) throw notFound('Registro não encontrado.');
    if (!Object.keys(MANUAL_UPDATE_TYPES).concat('correcao').includes(orig.type)) {
      throw badRequest('Registros automáticos do sistema não podem ser removidos.');
    }
    await db.query('UPDATE work_order_updates SET removed_at = now(), removed_by = $2, removed_reason = $3 WHERE id = $1',
      [updateId, user.id, reason]);
    await audit(db, { userId: user.id, action: 'remover_registro', entity: 'work_order_updates', entityId: updateId,
      details: { reason, description: orig.description, author: orig.user_id }, ip });
  });
}

async function addItem(user, id, { kind, description, quantity, unitPrice }, ip) {
  if (!['servico', 'peca'].includes(kind)) throw badRequest('Tipo de item inválido (servico ou peca).');
  if (!description) throw badRequest('Descreva o item.');
  const qty = quantity === undefined || quantity === null || quantity === '' ? 1 : Number(quantity);
  if (!(qty > 0)) throw badRequest('Quantidade inválida.');
  // Preço opcional aqui; pode ser informado ou corrigido no fechamento da venda.
  let price = null;
  if (unitPrice !== undefined && unitPrice !== null && unitPrice !== '') {
    const cents = require('../lib/saleCalc').toCents(unitPrice, 'preço');
    if (cents < 0) throw badRequest('O preço não pode ser negativo.');
    price = cents / 100;
  }
  return withTransaction(async (db) => {
    await lockOrder(db, id);
    const { rows: [item] } = await db.query(
      `INSERT INTO work_order_items (work_order_id, kind, description, quantity, unit_price, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, kind, description, qty, price, user.id]);
    const text = kind === 'peca' ? `Peça adicionada: ${description} (qtd. ${qty})` : `Serviço solicitado: ${description}`;
    await addUpdate(db, id, user.id, kind, text, { metadata: { itemId: item.id } });
    await audit(db, { userId: user.id, action: 'adicionar_item', entity: 'work_orders', entityId: id, details: { itemId: item.id, kind, description }, ip });
    return item;
  });
}

async function markItemDone(user, id, itemId, ip) {
  return withTransaction(async (db) => {
    await lockOrder(db, id);
    const { rows: [item] } = await db.query(
      `UPDATE work_order_items SET status = 'realizado', performed_by = $3, performed_at = now()
        WHERE id = $1 AND work_order_id = $2 AND removed_at IS NULL AND status = 'solicitado' RETURNING *`, [itemId, id, user.id]);
    if (!item) throw notFound('Item não encontrado ou já realizado.');
    await addUpdate(db, id, user.id, item.kind, `${item.kind === 'peca' ? 'Peça aplicada' : 'Serviço realizado'}: ${item.description}`,
      { metadata: { itemId: item.id } });
    await audit(db, { userId: user.id, action: 'concluir_item', entity: 'work_orders', entityId: id, details: { itemId }, ip });
    return item;
  });
}

async function removeItem(user, id, itemId, ip) {
  return withTransaction(async (db) => {
    await lockOrder(db, id);
    const { rows: [item] } = await db.query(
      `UPDATE work_order_items SET removed_at = now(), removed_by = $3
        WHERE id = $1 AND work_order_id = $2 AND removed_at IS NULL RETURNING *`, [itemId, id, user.id]);
    if (!item) throw notFound('Item não encontrado.');
    await addUpdate(db, id, user.id, 'remocao', `Item removido: ${item.description}`, { metadata: { itemId: item.id } });
    await audit(db, { userId: user.id, action: 'remover_item', entity: 'work_orders', entityId: id, details: { itemId }, ip });
  });
}

module.exports = {
  STATUS, ACTIVE_STATUSES, formatNumber, parseNumber,
  create, getDetail, search, editFields, changeStatus, finish, cancel,
  addManualUpdate, correctUpdate, removeUpdate, addItem, markItemDone, removeItem,
  // usados por services/tickets.js
  lockOrder, addUpdate, FINAL_STATUSES,
};
