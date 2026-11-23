const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, resetDb, login, createApp } = require('./helpers');

let app, admin, joao, carlos, paulo, ana, wo1, wo2;

async function newOrder(plate) {
  const c = await joao.post('/api/customers').send({ name: `Cliente ${plate}`, phone: '11999990000' });
  const m = await joao.post('/api/motorcycles').send({ customerId: c.body.id, brand: 'Honda', model: 'CG 160', year: 2021, plate });
  const w = await joao.post('/api/work-orders').send({ motorcycleId: m.body.id, complaint: 'Barulho no motor' });
  assert.equal(w.status, 201);
  return w.body;
}

before(async () => {
  await resetDb();
  app = createApp();
  [admin, joao, carlos, paulo, ana] = await Promise.all(['admin', 'joao', 'carlos', 'paulo', 'ana'].map((u) => login(app, u)));
  wo1 = await newOrder('AAA1A11');
  wo2 = await newOrder('BBB2B22');
});
after(() => pool.end());

test('consulta não abre nem responde chamado, mas lê os da comanda', async () => {
  assert.equal((await ana.post(`/api/work-orders/${wo1.id}/tickets`).send({ body: 'oi' })).status, 403);
  assert.equal((await ana.get('/api/tickets/summary')).status, 403);
  assert.equal((await ana.get(`/api/work-orders/${wo1.id}/tickets`)).status, 200);
});

test('mecânico abre chamado para o balcão; autor e horário vêm do servidor', async () => {
  assert.equal((await carlos.post(`/api/work-orders/${wo1.id}/tickets`).send({ body: '   ' })).status, 400);
  const r = await carlos.post(`/api/work-orders/${wo1.id}/tickets`)
    .send({ body: 'Cliente autoriza trocar a corrente?', userId: 1, created_at: '2000-01-01' });
  assert.equal(r.status, 201);
  assert.equal(r.body.target, 'balcao');
  assert.equal(r.body.opened_by_name, 'Carlos');
  assert.equal(r.body.messages.length, 1);
  assert.equal(r.body.messages[0].user_name, 'Carlos');
  assert.ok(new Date(r.body.messages[0].created_at).getFullYear() > 2000);
  assert.equal(r.body.unread, 0); // o autor já leu a própria mensagem
});

test('fila e não lidas: balcão vê; outro mecânico não vê chamado do balcão', async () => {
  const sj = (await joao.get('/api/tickets/summary')).body;
  assert.deepEqual([sj.open, sj.unread], [1, 1]);
  assert.equal((await admin.get('/api/tickets/summary')).body.unread, 1);
  const sp = (await paulo.get('/api/tickets/summary')).body;
  assert.deepEqual([sp.open, sp.unread], [0, 0]);
  const list = (await joao.get('/api/tickets')).body.data;
  assert.equal(list.length, 1);
  assert.equal(list[0].code, wo1.code);
  assert.equal(list[0].plate, 'AAA1A11');
  assert.equal(list[0].last_body, 'Cliente autoriza trocar a corrente?');
});

test('resposta nos dois sentidos e marcação de leitura', async () => {
  const [t] = (await joao.get('/api/tickets')).body.data;
  const r = await joao.post(`/api/tickets/${t.id}/messages`).send({ body: 'Liguei, ele autorizou.' });
  assert.equal(r.status, 201);
  assert.equal(r.body.messages.length, 2);
  assert.equal((await joao.get('/api/tickets/summary')).body.unread, 0); // responder marca como lido
  assert.equal((await carlos.get('/api/tickets/summary')).body.unread, 1);
  assert.equal((await carlos.post(`/api/tickets/${t.id}/read`)).status, 204);
  assert.equal((await carlos.get('/api/tickets/summary')).body.unread, 0);
  // Admin ainda não leu as duas mensagens.
  assert.equal((await admin.get('/api/tickets/summary')).body.unread, 2);
});

test('atendente abre chamado para a oficina (todos os mecânicos veem)', async () => {
  const r = await joao.post(`/api/work-orders/${wo2.id}/tickets`).send({ body: 'Já dá para passar prazo ao cliente?' });
  assert.equal(r.body.target, 'oficina');
  assert.equal((await paulo.get('/api/tickets/summary')).body.unread, 1);
  assert.equal((await carlos.get('/api/tickets/summary')).body.open, 2); // o seu do balcão + o da oficina
});

test('encerrar exige resumo, grava na linha do tempo e bloqueia novas mensagens', async () => {
  const [t] = (await carlos.get(`/api/work-orders/${wo1.id}/tickets`)).body.data;
  assert.equal((await carlos.post(`/api/tickets/${t.id}/close`).send({ summary: '' })).status, 400);
  const r = await carlos.post(`/api/tickets/${t.id}/close`).send({ summary: 'Troca da corrente autorizada pelo cliente.' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'encerrado');
  assert.equal(r.body.closed_by_name, 'Carlos');
  assert.equal((await joao.post(`/api/tickets/${t.id}/messages`).send({ body: 'mais uma' })).status, 409);
  assert.equal((await joao.post(`/api/tickets/${t.id}/close`).send({ summary: 'de novo' })).status, 409);

  const detail = (await ana.get(`/api/work-orders/${wo1.id}`)).body;
  const entry = detail.updates.find((u) => u.type === 'chamado');
  assert.ok(entry.description.includes('Troca da corrente autorizada'));
  // Registro automático: não pode ser corrigido nem removido.
  assert.notEqual((await admin.post(`/api/work-orders/${wo1.id}/updates/${entry.id}/correct`).send({ description: 'x' })).status, 201);
  // A conversa inteira continua visível na comanda.
  const hist = (await ana.get(`/api/work-orders/${wo1.id}/tickets`)).body.data[0];
  assert.equal(hist.messages.length, 2);
  // Encerrado sai da contagem de abertos.
  assert.equal((await joao.get('/api/tickets/summary')).body.open, 1); // resta o que ele abriu para a oficina
  assert.equal((await joao.get('/api/tickets?status=encerrado')).body.data.length, 1);

  const { rows } = await pool.query(`SELECT action FROM audit_logs WHERE entity = 'work_order_tickets' ORDER BY id`);
  assert.deepEqual(rows.map((x) => x.action), ['abrir_chamado', 'responder_chamado', 'abrir_chamado', 'encerrar_chamado']);
});

test('concluir/cancelar a comanda encerra os chamados abertos e impede novos', async () => {
  const before = (await joao.get(`/api/work-orders/${wo2.id}`)).body;
  const r = await joao.post(`/api/work-orders/${wo2.id}/cancel`).send({ version: before.version, reason: 'Cliente desistiu' });
  assert.equal(r.status, 200);
  const [t] = (await joao.get(`/api/work-orders/${wo2.id}/tickets`)).body.data;
  assert.equal(t.status, 'encerrado');
  assert.equal(t.auto_closed, true);
  assert.ok(r.body.updates.some((u) => u.type === 'chamado' && u.description.includes('automaticamente')));
  assert.equal((await paulo.get('/api/tickets/summary')).body.unread, 0);
  assert.equal((await carlos.post(`/api/work-orders/${wo2.id}/tickets`).send({ body: 'oi' })).status, 409);
  assert.equal((await carlos.post(`/api/tickets/${t.id}/messages`).send({ body: 'oi' })).status, 409);
});

test('chamado inexistente → 404', async () => {
  assert.equal((await joao.get('/api/tickets/9999')).status, 404);
  assert.equal((await joao.post('/api/tickets/9999/messages').send({ body: 'x' })).status, 404);
  assert.equal((await joao.get('/api/work-orders/9999/tickets')).status, 404);
});
