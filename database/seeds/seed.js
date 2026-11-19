/*
 * Cria o administrador inicial (obrigatório) e, com --demo, dados de demonstração.
 *   npm run seed                      -> admin / senha de ADMIN_PASSWORD (ou "admin123")
 *   npm run seed -- --demo            -> + funcionários, clientes, motos e comandas de exemplo
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../../server/config/db');
const { migrate } = require('../migrate');

async function upsertUser(name, username, role, password, mustChange) {
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (role_id, name, username, password_hash, must_change_password)
     SELECT id, $1, $2, $3, $5 FROM roles WHERE code = $4
     ON CONFLICT (lower(username)) DO NOTHING RETURNING id`,
    [name, username, hash, role, mustChange]);
  if (rows[0]) return rows[0].id;
  return (await pool.query('SELECT id FROM users WHERE lower(username) = $1', [username])).rows[0].id;
}

async function seed({ demo = false } = {}) {
  await migrate({ log: () => {} });
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const adminId = await upsertUser('Administrador', 'admin', 'admin', adminPass, !process.env.ADMIN_PASSWORD);
  console.log(`[seed] usuário "admin" pronto${process.env.ADMIN_PASSWORD ? '' : ' (senha inicial: admin123 — troque no primeiro acesso)'}`);
  if (!demo) return;

  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM customers');
  if (n > 0) { console.log('[seed] já existem clientes; dados de demonstração não foram inseridos.'); return; }

  const joao = await upsertUser('João Atendente', 'joao', 'atendente', 'demo123', false);
  const carlos = await upsertUser('Carlos Mecânico', 'carlos', 'mecanico', 'demo123', false);
  await upsertUser('Paulo Mecânico', 'paulo', 'mecanico', 'demo123', false);
  await upsertUser('Ana Consulta', 'ana', 'consulta', 'demo123', false);

  const cust = async (name, phone) => (await pool.query(
    'INSERT INTO customers (name, phone, created_by) VALUES ($1,$2,$3) RETURNING id', [name, phone, adminId])).rows[0].id;
  const moto = async (c, brand, model, year, plate, km) => (await pool.query(
    `INSERT INTO motorcycles (customer_id, brand, model, year, plate, current_km, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [c, brand, model, year, plate, km, adminId])).rows[0].id;

  const c1 = await cust('João da Silva', '11987654321');
  const c2 = await cust('Maria Oliveira', '11912345678');
  const m1 = await moto(c1, 'Honda', 'CG 160', 2021, 'ABC1D23', 25300);
  await moto(c2, 'Yamaha', 'Fazer 250', 2019, 'XYZ9876', 41000);

  const { rows: [wo] } = await pool.query(
    `INSERT INTO work_orders (customer_id, motorcycle_id, entry_km, complaint, opened_by, status)
     VALUES ($1,$2,25300,'Dificuldade na partida.',$3,'em_execucao') RETURNING id`, [c1, m1, joao]);
  const up = (u, type, d, from, to) => pool.query(
    `INSERT INTO work_order_updates (work_order_id, user_id, type, description, from_status, to_status) VALUES ($1,$2,$3,$4,$5,$6)`,
    [wo.id, u, type, d, from || null, to || null]);
  await up(joao, 'abertura', 'Comanda criada. Reclamação do cliente: Dificuldade na partida.', null, 'aberta');
  await up(carlos, 'status', 'Status alterado de "Aberta" para "Em diagnóstico".', 'aberta', 'em_diagnostico');
  await up(carlos, 'diagnostico', 'Identificado problema no motor de partida. Necessária substituição da peça.');
  await up(carlos, 'status', 'Status alterado de "Em diagnóstico" para "Em execução".', 'em_diagnostico', 'em_execucao');
  await pool.query(
    `INSERT INTO work_order_items (work_order_id, kind, description, quantity, created_by) VALUES
     ($1,'servico','Substituição do motor de partida',1,$2), ($1,'peca','Motor de partida',1,$2)`, [wo.id, carlos]);
  console.log('[seed] dados de demonstração inseridos (senha dos funcionários de exemplo: demo123)');
}

if (require.main === module) {
  seed({ demo: process.argv.includes('--demo') })
    .then(() => pool.end())
    .catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed };
