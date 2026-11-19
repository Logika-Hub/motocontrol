const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, pool, resetDb, login, createApp } = require('./helpers');

let app; let admin; let joao; let carlos; let paulo; let ana;
let customerId; let motoId; let wo;

before(async () => {
  await resetDb();
  app = createApp();
  [admin, joao, carlos, paulo, ana] = await Promise.all(['admin', 'joao', 'carlos', 'paulo', 'ana'].map((u) => login(app, u)));
});
after(() => pool.end());

test('rotas exigem autenticação e login inválido é recusado', async () => {
  assert.equal((await request(app).get('/api/customers')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'x' })).status, 401);
  const me = await joao.get('/api/auth/me');
  assert.equal(me.body.user.role, 'atendente');
});

test('administrador cadastra funcionário, que acessa com conta própria; desativação é imediata', async () => {
  const r = await admin.post('/api/users').send({ name: 'Novo Mecânico', username: 'novo', role: 'mecanico', password: 'abc12345' });
  assert.equal(r.status, 201);
  const novo = request.agent(app);
  assert.equal((await novo.post('/api/auth/login').send({ username: 'novo', password: 'abc12345' })).status, 200);
  assert.equal((await novo.get('/api/auth/me')).body.user.mustChangePassword, true);
  assert.equal((await admin.patch(`/api/users/${r.body.id}`).send({ active: false })).status, 200);
  assert.equal((await novo.get('/api/auth/me')).status, 401);
});

test('permissões são verificadas no back-end', async () => {
  assert.equal((await joao.get('/api/users')).status, 403);
  assert.equal((await ana.post('/api/customers').send({ name: 'X', phone: '11999999999' })).status, 403);
  assert.equal((await carlos.post('/api/customers').send({ name: 'X', phone: '11999999999' })).status, 403);
});

test('atendente cadastra cliente e motocicleta (placa normalizada, CPF validado)', async () => {
  assert.equal((await joao.post('/api/customers').send({ name: 'Sem Fone' })).status, 400);
  assert.equal((await joao.post('/api/customers').send({ name: 'CPF Ruim', phone: '11999999999', cpf: '111.111.111-11' })).status, 400);
  const c = await joao.post('/api/customers').send({ name: 'João da Silva', phone: '(11) 98765-4321', cpf: '529.982.247-25' });
  assert.equal(c.status, 201);
  customerId = c.body.id;
  const m = await joao.post('/api/motorcycles').send({ customerId, brand: 'Honda', model: 'CG 160', year: 2021, plate: 'abc-1d23', currentKm: 20000 });
  assert.equal(m.status, 201);
  assert.equal(m.body.plate, 'ABC1D23');
  motoId = m.body.id;
  assert.equal((await joao.post('/api/motorcycles').send({ customerId, brand: 'Honda', model: 'Biz', year: 2020, plate: 'ABC1D23' })).status, 409);
  const s = await ana.get('/api/motorcycles?q=1d2');
  assert.equal(s.body.items[0].id, motoId);
});

test('comanda é criada com número sequencial e vinculada ao cliente e à moto', async () => {
  const r = await joao.post('/api/work-orders').send({ motorcycleId: motoId, entryKm: 25300, complaint: 'Dificuldade na partida' });
  assert.equal(r.status, 201);
  wo = r.body;
  assert.equal(wo.code, 'OS-000001');
  assert.equal(wo.customer_id, customerId);
  assert.equal(wo.opened_by_name, 'João');
  assert.equal(wo.updates[0].type, 'abertura');
  // Segunda comanda em andamento para a mesma moto é bloqueada.
  assert.equal((await joao.post('/api/work-orders').send({ motorcycleId: motoId, complaint: 'outra' })).status, 409);
  // Km da moto atualizada com a km de entrada.
  assert.equal((await ana.get(`/api/motorcycles/${motoId}`)).body.current_km, 25300);
});

test('mecânicos diferentes registram atividades; cada registro tem autor e horário do servidor', async () => {
  const before = Date.now();
  let r = await carlos.post(`/api/work-orders/${wo.id}/status`).send({ status: 'em_diagnostico', version: wo.version });
  assert.equal(r.status, 200);
  r = await carlos.post(`/api/work-orders/${wo.id}/updates`).send({ type: 'diagnostico', description: 'Problema no motor de partida.' });
  assert.equal(r.status, 201);
  r = await paulo.post(`/api/work-orders/${wo.id}/items`).send({ kind: 'peca', description: 'Motor de partida', quantity: 1 });
  r = await paulo.post(`/api/work-orders/${wo.id}/items`).send({ kind: 'servico', description: 'Troca do motor de partida' });
  assert.equal(r.status, 201);
  // Cliente não consegue forjar autor/horário.
  r = await paulo.post(`/api/work-orders/${wo.id}/updates`).send({ type: 'observacao', description: 'Teste', user_id: 1, created_at: '2000-01-01' });
  const last = r.body.updates.at(-1);
  assert.equal(last.user_name, 'Paulo');
  assert.ok(new Date(last.created_at).getTime() >= before - 5000);
  const authors = new Set(r.body.updates.map((u) => u.user_name));
  assert.ok(authors.has('Carlos') && authors.has('Paulo') && authors.has('João'));
  wo = r.body;
});

test('atendente não pode registrar diagnóstico; consulta não pode alterar', async () => {
  assert.equal((await joao.post(`/api/work-orders/${wo.id}/updates`).send({ type: 'diagnostico', description: 'x' })).status, 403);
  assert.equal((await ana.post(`/api/work-orders/${wo.id}/updates`).send({ type: 'observacao', description: 'x' })).status, 403);
  assert.equal((await joao.patch(`/api/work-orders/${wo.id}`).send({ version: wo.version, diagnosis: 'x' })).status, 403);
});

test('edição concorrente com versão desatualizada é recusada (RN12)', async () => {
  const v = wo.version;
  const a = await carlos.patch(`/api/work-orders/${wo.id}`).send({ version: v, diagnosis: 'Motor de partida em curto' });
  assert.equal(a.status, 200);
  const b = await paulo.patch(`/api/work-orders/${wo.id}`).send({ version: v, diagnosis: 'Outro diagnóstico' });
  assert.equal(b.status, 409);
  wo = a.body;
  assert.equal(wo.diagnosis, 'Motor de partida em curto');
});

test('aberturas simultâneas geram números únicos (RN01)', async () => {
  const motos = [];
  for (let i = 0; i < 5; i++) {
    const m = await joao.post('/api/motorcycles').send({ customerId, brand: 'Yamaha', model: 'Factor', year: 2020, plate: `QWE${i}A1${i}` });
    motos.push(m.body.id);
  }
  const res = await Promise.all(motos.map((id) => joao.post('/api/work-orders').send({ motorcycleId: id, complaint: 'Revisão' })));
  const numbers = res.map((r) => r.body.number);
  assert.equal(new Set(numbers).size, 5);
});

test('correções preservam o registro original; remoção é restrita e auditada', async () => {
  const obs = wo.updates.find((u) => u.description === 'Teste');
  assert.equal((await carlos.post(`/api/work-orders/${wo.id}/updates/${obs.id}/correct`).send({ description: 'x' })).status, 403);
  let r = await paulo.post(`/api/work-orders/${wo.id}/updates/${obs.id}/correct`).send({ description: 'Teste corrigido' });
  assert.equal(r.status, 201);
  assert.ok(r.body.updates.find((u) => u.id === obs.id).corrected);
  assert.equal(r.body.updates.at(-1).corrects_update_id, obs.id);
  assert.equal((await paulo.delete(`/api/work-orders/${wo.id}/updates/${obs.id}`).send({ reason: 'x' })).status, 403);
  r = await admin.delete(`/api/work-orders/${wo.id}/updates/${obs.id}`).send({ reason: 'Registro de teste' });
  assert.equal(r.status, 200);
  assert.ok(r.body.updates.find((u) => u.id === obs.id).removed_at);
  const { rows } = await pool.query(`SELECT * FROM audit_logs WHERE action = 'remover_registro'`);
  assert.equal(rows.length, 1);
  wo = r.body;
});

test('conclusão exige serviços realizados; concluída fica imutável e consultável', async () => {
  let r = await carlos.post(`/api/work-orders/${wo.id}/finish`).send({ version: wo.version });
  assert.equal(r.status, 409);
  const servico = wo.items.find((i) => i.kind === 'servico');
  r = await carlos.post(`/api/work-orders/${wo.id}/items/${servico.id}/done`);
  assert.equal(r.body.items.find((i) => i.id === servico.id).performed_by_name, 'Carlos');
  r = await carlos.post(`/api/work-orders/${wo.id}/finish`).send({ version: r.body.version, closingNotes: 'Testado ok' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'concluida');
  assert.equal(r.body.closed_by_name, 'Carlos');
  assert.equal((await carlos.post(`/api/work-orders/${wo.id}/updates`).send({ type: 'observacao', description: 'x' })).status, 409);
  const hist = await ana.get(`/api/motorcycles/${motoId}`);
  assert.equal(hist.body.history[0].status, 'concluida');
  assert.equal(hist.body.history[0].items.length, 2);
});

test('cancelamento exige justificativa e registra o responsável (RN11)', async () => {
  const list = await ana.get('/api/work-orders?status=aberta');
  const target = list.body.items[0];
  const d = (await ana.get(`/api/work-orders/${target.id}`)).body;
  assert.equal((await joao.post(`/api/work-orders/${target.id}/cancel`).send({ version: d.version })).status, 400);
  const r = await joao.post(`/api/work-orders/${target.id}/cancel`).send({ version: d.version, reason: 'Cliente desistiu' });
  assert.equal(r.body.status, 'cancelada');
  assert.equal(r.body.closed_by_name, 'João');
});

test('cliente e moto com comandas não podem ser excluídos (RN10)', async () => {
  assert.equal((await admin.delete(`/api/motorcycles/${motoId}`)).status, 409);
  assert.equal((await admin.delete(`/api/customers/${customerId}`)).status, 409);
});

test('consulta de comandas com filtros e dashboard', async () => {
  let r = await ana.get('/api/work-orders?number=OS-000001');
  assert.equal(r.body.total, 1);
  r = await ana.get('/api/work-orders?plate=abc1d');
  assert.equal(r.body.items[0].code, 'OS-000001');
  const { rows: [carlosRow] } = await pool.query(`SELECT id FROM users WHERE username = 'carlos'`);
  r = await ana.get(`/api/work-orders?userId=${carlosRow.id}`);
  assert.equal(r.body.total, 1);
  const today = new Date().toISOString().slice(0, 10);
  r = await ana.get(`/api/work-orders?from=${today}&to=${today}&status=concluida,cancelada`);
  assert.equal(r.body.total, 2);
  r = await ana.get('/api/dashboard');
  assert.equal(r.body.counts.aberta, 4);
  assert.equal(r.body.counts.concluidas_hoje, 1);
  assert.ok(r.body.activity.length > 0);
});

test('backup pode ser gerado e restaurado', async () => {
  const backup = require('../server/services/backup');
  const b = await admin.post('/api/admin/backups');
  assert.equal(b.status, 201);
  await pool.query(`UPDATE customers SET name = 'Alterado' WHERE id = $1`, [customerId]);
  await backup.restoreBackup(b.body.file);
  const { rows } = await pool.query('SELECT name FROM customers WHERE id = $1', [customerId]);
  assert.equal(rows[0].name, 'João da Silva');
  assert.equal((await joao.post('/api/admin/backups')).status, 403);
});

test('manual do usuário é servido em /ajuda sem login', async () => {
  assert.equal((await request(app).get('/ajuda')).status, 301);
  const idx = await request(app).get('/ajuda/');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /Manual do MotoControl/);
  const page = await request(app).get('/ajuda/02-comandas');
  assert.equal(page.status, 200);
  assert.match(page.text, /id="abrir-uma-comanda"/);
  assert.match(page.text, /href="03-clientes-e-motos"/);
  assert.equal((await request(app).get('/ajuda/imagens/comanda.png')).status, 200);
  assert.equal((await request(app).get('/ajuda/99-inexistente')).status, 404);
  assert.equal((await request(app).get('/ajuda/..%2f..%2fpackage')).status, 404);
});
