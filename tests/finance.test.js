// Financeiro (D19): fechamento de comanda, comissões, repasses, estornos, dashboards e permissões.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, login, createApp } = require('./helpers');

let app; let admin; let joao; let carlos; let paulo; let ana;
let uid = {}; let customerId; let plateSeq = 0;

before(async () => {
  await resetDb();
  app = createApp();
  [admin, joao, carlos, paulo, ana] = await Promise.all(['admin', 'joao', 'carlos', 'paulo', 'ana'].map((u) => login(app, u)));
  const { rows } = await pool.query('SELECT id, username FROM users');
  uid = Object.fromEntries(rows.map((r) => [r.username, r.id]));
  const c = await joao.post('/api/customers').send({ name: 'Cliente Financeiro', phone: '11988887777' });
  customerId = c.body.id;
});
after(() => pool.end());

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg || ''} esperado ${b}, obtido ${a}`);

/** Cria uma comanda com itens (cada serviço marcado como realizado por quem executou) e a conclui. */
async function mkOrder(items, { finish = true } = {}) {
  plateSeq += 1;
  const moto = await joao.post('/api/motorcycles').send({ customerId, brand: 'Honda', model: 'CG 160', year: 2022, plate: `FIN1A${String(plateSeq).padStart(2, '0')}` });
  assert.equal(moto.status, 201, JSON.stringify(moto.body));
  const wo = await joao.post('/api/work-orders').send({ motorcycleId: moto.body.id, complaint: 'Revisão' });
  const id = wo.body.id;
  for (const it of items) {
    const r = await carlos.post(`/api/work-orders/${id}/items`).send({ kind: it.kind || 'servico', description: it.description, quantity: it.quantity || 1, unitPrice: it.unitPrice });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const added = r.body.items[r.body.items.length - 1];
    assert.equal((await (it.by || carlos).post(`/api/work-orders/${id}/items/${added.id}/done`)).status, 200);
  }
  if (finish) {
    const d = (await joao.get(`/api/work-orders/${id}`)).body;
    const f = await joao.post(`/api/work-orders/${id}/finish`).send({ version: d.version });
    assert.equal(f.status, 200, JSON.stringify(f.body));
  }
  return (await joao.get(`/api/work-orders/${id}`)).body;
}

const itemsOf = (wo) => Object.fromEntries(wo.items.map((i) => [i.description, i.id]));
const pay = (list) => list.map(([method, amount]) => ({ method, amount }));

let wo1; let sale1;

test('permissões: consulta não acessa nada financeiro; mecânico só o painel próprio; atendente fecha mas não administra', async () => {
  for (const url of ['/api/finance/me', '/api/finance/overview', '/api/sales', '/api/finance/balances', '/api/finance/rules']) {
    assert.equal((await ana.get(url)).status, 403, `consulta em ${url}`);
  }
  assert.equal((await carlos.get('/api/finance/me')).status, 200);
  assert.equal((await joao.get('/api/finance/me')).status, 200);
  for (const url of ['/api/finance/overview', `/api/finance/team/${uid.paulo}`, '/api/finance/balances', '/api/finance/payouts', '/api/finance/rules', '/api/finance/collaborators', '/api/sales', '/api/sales/awaiting']) {
    assert.equal((await carlos.get(url)).status, 403, `mecânico em ${url}`);
  }
  for (const url of ['/api/finance/overview', `/api/finance/team/${uid.carlos}`, '/api/finance/balances', '/api/finance/payouts', '/api/finance/rules']) {
    assert.equal((await joao.get(url)).status, 403, `atendente em ${url}`);
  }
  assert.equal((await joao.get('/api/sales')).status, 200);
  assert.equal((await carlos.post('/api/sales').send({ workOrderId: 1 })).status, 403);
  assert.equal((await carlos.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 1, method: 'pix' })).status, 403);
  assert.equal((await joao.put('/api/finance/rules').send({ userId: null, type: 'percentual', value: 10 })).status, 403);
  assert.equal((await joao.post('/api/sales/1/void').send({ reason: 'x' })).status, 403);
  assert.equal((await (require('./helpers').request)(app).get('/api/finance/me')).status, 401);
});

test('regras de comissão: padrão, individual, validação e histórico preservado', async () => {
  assert.equal((await admin.put('/api/finance/rules').send({ userId: null, type: 'percentual', value: 150 })).status, 400);
  assert.equal((await admin.put('/api/finance/rules').send({ userId: null, type: 'percentual', value: -1 })).status, 400);
  assert.equal((await admin.put('/api/finance/rules').send({ userId: null, type: 'outro', value: 5 })).status, 400);
  assert.equal((await admin.put('/api/finance/rules').send({ userId: uid.ana, type: 'fixo', value: 5 })).status, 400, 'consulta não recebe comissão');
  assert.equal((await admin.put('/api/finance/rules').send({ userId: null, type: 'percentual', value: 5 })).status, 200);
  assert.equal((await admin.put('/api/finance/rules').send({ userId: null, type: 'percentual', value: 10 })).status, 200);
  assert.equal((await admin.put('/api/finance/rules').send({ userId: uid.carlos, type: 'fixo', value: 20 })).status, 200);
  const rules = (await admin.get('/api/finance/rules')).body;
  assert.equal(rules.default.value, 10);
  assert.equal(rules.items.length, 1);
  assert.equal(rules.history.length, 1, 'a regra de 5% foi encerrada, não editada');
  assert.equal(rules.history[0].value, 5);
});

test('fechamento: só comanda concluída; prévia e fechamento calculam no servidor (desconto proporcional, comissão por colaborador)', async () => {
  const open = await mkOrder([{ description: 'Troca de óleo', unitPrice: 100 }], { finish: false });
  const early = await joao.post('/api/sales').send({ workOrderId: open.id, payments: pay([['pix', 100]]) });
  assert.equal(early.status, 409, 'comanda em andamento não fecha');
  assert.match(early.body.error, /Conclua a comanda/);

  wo1 = await mkOrder([
    { description: 'Troca de óleo', unitPrice: 100, by: carlos },
    { description: 'Revisão geral', unitPrice: 200, by: paulo },
    { kind: 'peca', description: 'Filtro de óleo', quantity: 2, unitPrice: 50, by: carlos },
  ]);
  const ids = itemsOf(wo1);
  const body = { workOrderId: wo1.id, discount: 40, items: [] };

  const seen = await joao.post('/api/sales/preview').send(body);
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.ok(!JSON.stringify(seen.body).includes('commission'), 'atendente não vê comissões na prévia');
  const prev = await admin.post('/api/sales/preview').send(body);
  assert.equal(prev.status, 200, JSON.stringify(prev.body));
  near(prev.body.subtotal, 400); near(prev.body.discount, 40); near(prev.body.total, 360);
  const byDesc = Object.fromEntries(prev.body.items.map((i) => [i.description, i]));
  near(byDesc['Troca de óleo'].net, 90); near(byDesc['Revisão geral'].net, 180); near(byDesc['Filtro de óleo'].net, 90);
  near(byDesc['Troca de óleo'].commission, 20, 'carlos: regra individual fixa'); // R$ 20 por serviço
  near(byDesc['Revisão geral'].commission, 18, 'paulo: regra padrão de 10% sobre o líquido');
  near(byDesc['Filtro de óleo'].commission, 0, 'peça não gera comissão');
  near(prev.body.commission_total, 38);
  assert.equal(byDesc['Troca de óleo'].user_id, uid.carlos);

  // valida pagamentos
  assert.equal((await joao.post('/api/sales').send({ ...body, payments: pay([['pix', 300]]) })).status, 400, 'soma diferente do total');
  assert.equal((await joao.post('/api/sales').send({ ...body, payments: pay([['cheque', 360]]) })).status, 400, 'forma inválida');
  assert.equal((await joao.post('/api/sales').send({ ...body, payments: [] })).status, 400, 'sem pagamento');
  assert.equal((await joao.post('/api/sales').send({ ...body, discount: 400, payments: pay([['pix', 1]]) })).status, 400, 'desconto não pode zerar a venda');
  assert.equal((await joao.post('/api/sales').send({ ...body, discount: -5, payments: pay([['pix', 405]]) })).status, 400, 'desconto negativo');
  assert.equal((await joao.post('/api/sales').send({ ...body, items: [{ itemId: 999999, unitPrice: 1 }], payments: pay([['pix', 360]]) })).status, 400, 'item de outra comanda');
  assert.equal((await joao.post('/api/sales').send({ ...body, items: [{ itemId: ids['Troca de óleo'], userId: uid.ana }], payments: pay([['pix', 360]]) })).status, 400, 'responsável de consulta');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM sales')).rows[0].n, 0, 'nenhuma tentativa inválida gravou venda');

  // pagamento dividido em PIX + dinheiro + crédito
  const ok = await joao.post('/api/sales').send({ ...body, payments: pay([['pix', 200], ['dinheiro', 100], ['credito', 60]]), notes: 'Cliente pagou em três formas' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  sale1 = ok.body;
  assert.equal(sale1.status, 'concluida');
  near(sale1.total, 360);
  assert.equal(sale1.payments.length, 3);
  assert.equal(sale1.closed_by_name, 'João');
  assert.ok(sale1.items.every((i) => i.commission_amount === undefined), 'atendente não vê comissões');

  const detail = (await joao.get(`/api/work-orders/${wo1.id}`)).body;
  assert.equal(detail.sale.id, sale1.id);
  assert.ok(detail.updates.some((u) => u.type === 'venda' && /Venda #\d+ fechada/.test(u.description)));
  const adminView = (await admin.get(`/api/sales/${sale1.id}`)).body;
  near(adminView.items.find((i) => i.description === 'Troca de óleo').commission_amount, 20);
  assert.equal(adminView.items.find((i) => i.description === 'Troca de óleo').commission_type, 'fixo');
});

test('uma comanda não pode ser fechada duas vezes (sequencial e simultâneo)', async () => {
  const again = await joao.post('/api/sales').send({ workOrderId: wo1.id, discount: 40, payments: pay([['pix', 360]]) });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /já foi fechada/);

  const wo = await mkOrder([{ description: 'Alinhamento', unitPrice: 80, by: paulo }]);
  const req = () => joao.post('/api/sales').send({ workOrderId: wo.id, payments: pay([['debito', 80]]) });
  const results = await Promise.all([req(), req(), admin.post('/api/sales').send({ workOrderId: wo.id, payments: pay([['debito', 80]]) })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sales WHERE work_order_id = $1 AND status = 'concluida'`, [wo.id])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.work_order_id = $1`, [wo.id])).rows[0].n, 1, 'sem itens duplicados');
});

test('comanda cancelada não gera venda; item sem preço exige preço no fechamento', async () => {
  const wo = await mkOrder([{ description: 'Diagnóstico eletrônico', by: carlos }]); // sem preço
  const noPrice = await joao.post('/api/sales').send({ workOrderId: wo.id, payments: pay([['pix', 50]]) });
  assert.equal(noPrice.status, 400);
  assert.match(noPrice.body.error, /Informe o preço/);
  const closing = (await joao.get(`/api/sales/closing/${wo.id}`)).body;
  assert.equal(closing.items[0].unit_price, null);
  assert.equal(closing.items[0].performed_by, uid.carlos, 'responsável sugerido = quem realizou o serviço');
  assert.ok(closing.collaborators.every((c) => c.id !== uid.ana));
  const priced = await joao.post('/api/sales').send({ workOrderId: wo.id, items: [{ itemId: closing.items[0].id, unitPrice: '75,50', userId: uid.paulo }], payments: pay([['dinheiro', '75,50']]) });
  assert.equal(priced.status, 201, JSON.stringify(priced.body));
  near(priced.body.total, 75.5);
  assert.equal(priced.body.items[0].user_id, uid.paulo, 'responsável trocado no fechamento');

  plateSeq += 1;
  const moto = await joao.post('/api/motorcycles').send({ customerId, brand: 'Yamaha', model: 'Fazer', year: 2020, plate: `FIN1A${String(plateSeq).padStart(2, '0')}` });
  const canc = await joao.post('/api/work-orders').send({ motorcycleId: moto.body.id, complaint: 'x' });
  await joao.post(`/api/work-orders/${canc.body.id}/cancel`).send({ version: canc.body.version, reason: 'Desistiu' });
  assert.equal((await joao.post('/api/sales').send({ workOrderId: canc.body.id, payments: pay([['pix', 1]]) })).status, 409);
});

test('painel individual: só os próprios dados; vendido, serviços, ticket médio, a receber e recebido', async () => {
  // Estado: venda 1 (carlos: 90 / R$20; paulo: 180 / R$18), venda 2 (paulo: 80 / 10% = 8), venda 3 (paulo: 75,50 / 7,55)
  const c = (await carlos.get(`/api/finance/me?userId=${uid.paulo}`)).body; // o parâmetro é ignorado
  assert.equal(c.user.id, uid.carlos);
  near(c.summary.sold, 90); assert.equal(c.summary.services, 1); assert.equal(c.summary.sales, 1);
  near(c.summary.average_ticket, 90); near(c.summary.commission_earned, 20);
  near(c.totals.earned, 20); near(c.totals.paid, 0); near(c.totals.pending, 20);
  assert.ok(c.evolution.length >= 1 && c.top_services[0].description === 'Troca de óleo');

  const p = (await paulo.get('/api/finance/me')).body;
  near(p.summary.sold, 180 + 80 + 75.5); assert.equal(p.summary.services, 3); assert.equal(p.summary.sales, 3);
  near(p.summary.average_ticket, (180 + 80 + 75.5) / 3);
  near(p.totals.earned, 18 + 8 + 7.55);

  // histórico de serviços do colaborador não inclui nada dos outros
  const mine = (await carlos.get('/api/finance/me/services')).body;
  assert.equal(mine.total, 1);
  assert.deepEqual(mine.items.map((i) => i.description), ['Troca de óleo']);
  assert.ok(mine.items[0].code.startsWith('OS-'));
  const theirs = (await paulo.get('/api/finance/me/services')).body;
  assert.equal(theirs.total, 3);

  // filtros de período
  const old = (await carlos.get('/api/finance/me?from=2000-01-01&to=2000-01-31')).body;
  assert.equal(old.summary.services, 0); near(old.summary.sold, 0); near(old.totals.pending, 20, 'o saldo é histórico, não do período');
  assert.equal((await carlos.get('/api/finance/me?from=2030-02-01&to=2030-01-01')).status, 400);
  assert.equal((await carlos.get('/api/finance/me?from=abc')).status, 400);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await carlos.get(`/api/finance/me?from=${today}&to=${today}&group=day`)).status, 200);
});

test('visão geral do administrador: faturamento, formas de pagamento, equipe e ranking vêm dos registros', async () => {
  const o = (await admin.get('/api/finance/overview')).body;
  near(o.summary.revenue, 360 + 80 + 75.5); assert.equal(o.summary.sales, 3);
  near(o.summary.average_ticket, (360 + 80 + 75.5) / 3);
  assert.equal(o.summary.services, 4); // venda 1: 2 serviços; vendas 2 e 3: 1 cada
  near(o.summary.commission_earned, 38 + 8 + 7.55);
  near(o.summary.pending_commissions, 38 + 8 + 7.55);
  near(o.summary.discounts, 40);
  const methods = Object.fromEntries(o.by_method.map((m) => [m.method, m.amount]));
  near(methods.pix, 200); near(methods.dinheiro, 100 + 75.5); near(methods.credito, 60); near(methods.debito, 80);
  const team = Object.fromEntries(o.team.map((t) => [t.name, t]));
  near(team.Paulo.sold, 335.5); near(team.Carlos.sold, 90);
  assert.equal(o.ranking.sold[0].name, 'Paulo');
  assert.equal(o.ranking.services[0].name, 'Paulo');
  assert.equal(o.ranking.overall[0].name, 'Paulo');
  assert.ok(o.top_by_count.length > 0 && o.top_by_amount.length > 0);
  assert.ok(!o.team.some((t) => t.name === 'Ana'), 'perfil de consulta não entra no ranking');

  const full = (await admin.get(`/api/finance/team/${uid.carlos}`)).body;
  assert.equal(full.user.name, 'Carlos'); near(full.summary.sold, 90);
  assert.equal((await admin.get('/api/finance/team/99999')).status, 404);
});

test('comandas concluídas sem venda aparecem como aguardando fechamento', async () => {
  const wo = await mkOrder([{ description: 'Troca de pneu', unitPrice: 120, by: paulo }]);
  const list = (await joao.get('/api/sales/awaiting')).body.data;
  assert.ok(list.some((w) => w.id === wo.id));
  assert.ok(!list.some((w) => w.id === wo1.id));
  const o = (await admin.get('/api/finance/overview')).body;
  assert.ok(o.summary.awaiting_closing >= 1);
  near(o.summary.awaiting_closing_amount, 120);
  await joao.post('/api/sales').send({ workOrderId: wo.id, payments: pay([['pix', 120]]) });
  assert.ok(!(await joao.get('/api/sales/awaiting')).body.data.some((w) => w.id === wo.id));
});

test('repasses: totais e parciais, nunca acima do saldo, visíveis só ao dono e ao administrador', async () => {
  const bal = () => admin.get('/api/finance/balances').then((r) => Object.fromEntries(r.body.data.map((b) => [b.name, b])));
  near((await bal()).Carlos.pending, 20);

  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 0, method: 'pix' })).status, 400);
  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: -5, method: 'pix' })).status, 400);
  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 5, method: 'bitcoin' })).status, 400);
  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.ana, amount: 5, method: 'pix' })).status, 400);
  const over = await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 20.01, method: 'pix' });
  assert.equal(over.status, 409); assert.match(over.body.error, /excede o saldo/);

  const part = await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 5, method: 'pix', note: 'Adiantamento' });
  assert.equal(part.status, 201);
  near((await bal()).Carlos.pending, 15); near((await bal()).Carlos.paid, 5);
  const rest = await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: '15,00', method: 'dinheiro' });
  assert.equal(rest.status, 201);
  near((await bal()).Carlos.pending, 0);
  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 0.01, method: 'pix' })).status, 409, 'saldo zerado');

  const me = (await carlos.get('/api/finance/me')).body;
  near(me.totals.paid, 20); near(me.totals.pending, 0); near(me.summary.paid, 20);
  const myPayouts = (await carlos.get('/api/finance/me/payouts')).body;
  assert.equal(myPayouts.total, 2);
  assert.ok(myPayouts.items.every((p) => p.user_id === uid.carlos));
  assert.equal((await paulo.get('/api/finance/me/payouts')).body.total, 0, 'paulo não vê repasses de carlos');
  assert.equal((await admin.get(`/api/finance/team/${uid.carlos}/payouts`)).body.total, 2);

  // simultaneidade: dois repasses de 12 sobre saldo de 33,55 não passam juntos de 3 — só um cabe quando o saldo é menor
  const paulPending = (await bal()).Paulo.pending; // 33,55
  const half = Math.round((paulPending * 100 * 0.6)) / 100; // 60% do saldo cada: só um dos dois cabe
  const rs = await Promise.all([1, 2].map(() => admin.post('/api/finance/payouts').send({ userId: uid.paulo, amount: half, method: 'pix' })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
  assert.ok((await bal()).Paulo.pending >= 0);
});

test('cancelar repasse exige motivo, mantém o registro e devolve o valor ao saldo', async () => {
  const list = (await admin.get(`/api/finance/payouts?userId=${uid.carlos}`)).body.items;
  const target = list.find((p) => p.note === 'Adiantamento');
  assert.equal((await admin.post(`/api/finance/payouts/${target.id}/cancel`).send({})).status, 400);
  assert.equal((await joao.post(`/api/finance/payouts/${target.id}/cancel`).send({ reason: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/finance/payouts/${target.id}/cancel`).send({ reason: 'Lançado no colaborador errado' })).status, 200);
  assert.equal((await admin.post(`/api/finance/payouts/${target.id}/cancel`).send({ reason: 'de novo' })).status, 409);
  const me = (await carlos.get('/api/finance/me')).body;
  near(me.totals.paid, 15); near(me.totals.pending, 5);
  const hist = (await carlos.get('/api/finance/me/payouts')).body.items;
  assert.equal(hist.length, 2, 'o registro cancelado continua no histórico');
  assert.equal(hist.find((p) => p.id === target.id).status, 'cancelado');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'cancelar_repasse'`)).rows[0].n, 1);
});

test('estorno: só administrador, exige motivo, sai dos totais e das comissões e permite novo fechamento com rastro', async () => {
  assert.equal((await joao.post(`/api/sales/${sale1.id}/void`).send({ reason: 'x' })).status, 403);
  assert.equal((await admin.post(`/api/sales/${sale1.id}/void`).send({})).status, 400);
  const before = (await admin.get('/api/finance/overview')).body.summary;

  const v = await admin.post(`/api/sales/${sale1.id}/void`).send({ reason: 'Preço digitado errado' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.status, 'estornada');
  assert.equal(v.body.voided_by_name, 'Admin');
  assert.equal((await admin.post(`/api/sales/${sale1.id}/void`).send({ reason: 'de novo' })).status, 409);

  const after = (await admin.get('/api/finance/overview')).body.summary;
  near(after.revenue, before.revenue - 360);
  assert.equal(after.sales, before.sales - 1);
  assert.equal(after.voided_count, 1); near(after.voided_amount, 360);
  // Carlos já recebeu 15 de 20; com o estorno ganha 0 → saldo negativo (a compensar) e nada a pagar
  const c = (await carlos.get('/api/finance/me')).body;
  near(c.totals.earned, 0); near(c.totals.pending, -15);
  assert.equal(c.summary.services, 0);
  near(after.overpaid, 15);
  assert.equal((await admin.post('/api/finance/payouts').send({ userId: uid.carlos, amount: 1, method: 'pix' })).status, 409);
  const mine = (await carlos.get('/api/finance/me/services')).body;
  assert.equal(mine.total, 1); assert.equal(mine.items[0].sale_status, 'estornada', 'o item estornado continua visível no histórico, marcado');

  // histórico mantém a venda estornada e a linha do tempo registra o estorno
  const hist = (await joao.get('/api/sales?status=estornada')).body;
  assert.equal(hist.total, 1);
  const detail = (await joao.get(`/api/work-orders/${wo1.id}`)).body;
  assert.equal(detail.sale, null);
  assert.ok(detail.updates.some((u) => u.type === 'venda' && /estornada/.test(u.description) && /Preço digitado errado/.test(u.description)));

  // novo fechamento correto (agora sem desconto), com nova venda e comissão recalculada pelas regras vigentes
  const re = await joao.post('/api/sales').send({ workOrderId: wo1.id, payments: pay([['pix', 400]]) });
  assert.equal(re.status, 201, JSON.stringify(re.body));
  assert.notEqual(re.body.id, sale1.id);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sales WHERE work_order_id = $1`, [wo1.id])).rows[0].n, 2);
  const c2 = (await carlos.get('/api/finance/me')).body;
  near(c2.totals.earned, 20); near(c2.totals.pending, 5);
});

test('regra nova vale só para fechamentos futuros; vendas fechadas guardam o retrato da comissão', async () => {
  await admin.put('/api/finance/rules').send({ userId: uid.paulo, type: 'percentual', value: 50 });
  const before = (await paulo.get('/api/finance/me')).body.totals.earned;
  const wo = await mkOrder([{ description: 'Regulagem', unitPrice: 100, by: paulo }]);
  const s = await joao.post('/api/sales').send({ workOrderId: wo.id, payments: pay([['pix', 100]]) });
  near(s.body.items.length ? (await admin.get(`/api/sales/${s.body.id}`)).body.items[0].commission_amount : -1, 50, 'nova regra de 50%');
  near((await paulo.get('/api/finance/me')).body.totals.earned, before + 50, 'vendas antigas não foram recalculadas');
  const ended = (await admin.get('/api/finance/rules')).body.items.find((r) => r.user_id === uid.paulo);
  assert.equal((await admin.delete(`/api/finance/rules/${ended.id}`)).status, 204);
  assert.equal((await admin.delete(`/api/finance/rules/${ended.id}`)).status, 404);
});

test('histórico de vendas: filtros por colaborador, forma de pagamento e período; auditoria das operações financeiras', async () => {
  const all = (await joao.get('/api/sales')).body;
  assert.ok(all.total >= 5);
  const first = all.items[0];
  assert.ok(first.code && first.collaborators && first.methods.length && first.customer_name);
  const byUser = (await joao.get(`/api/sales?userId=${uid.carlos}`)).body;
  assert.ok(byUser.items.every((s) => /Carlos/.test(s.collaborators)));
  const byMethod = (await joao.get('/api/sales?method=credito')).body;
  assert.ok(byMethod.total >= 1 && byMethod.items.every((s) => s.methods.some((m) => m.code === 'credito')));
  assert.equal((await joao.get('/api/sales?from=2000-01-01&to=2000-12-31')).body.total, 0);
  const byCode = (await joao.get(`/api/sales?q=${wo1.code}`)).body;
  assert.ok(byCode.items.every((s) => s.work_order_id === wo1.id));
  assert.equal((await ana.get('/api/sales')).status, 403);

  const actions = (await pool.query(`SELECT DISTINCT action FROM audit_logs WHERE action IN ('fechar_venda','estornar_venda','registrar_repasse','cancelar_repasse','definir_comissao','encerrar_comissao')`)).rows.map((r) => r.action).sort();
  assert.deepEqual(actions, ['cancelar_repasse', 'definir_comissao', 'encerrar_comissao', 'estornar_venda', 'fechar_venda', 'registrar_repasse']);
});

test('integridade no banco: soma dos pagamentos = total e itens fecham com o total', async () => {
  const { rows } = await pool.query(`
    SELECT s.id, s.total, (SELECT sum(amount) FROM sale_payments WHERE sale_id = s.id) AS paid,
           (SELECT sum(net_amount) FROM sale_items WHERE sale_id = s.id) AS net FROM sales s`);
  assert.ok(rows.length >= 5);
  for (const r of rows) { near(r.paid, r.total, `pagamentos da venda ${r.id}`); near(r.net, r.total, `itens da venda ${r.id}`); }
  await assert.rejects(pool.query(`UPDATE sales SET status = 'estornada' WHERE status = 'concluida'`), /./, 'estorno sem responsável e motivo é barrado pelo banco');
});
