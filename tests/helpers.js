process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://motocontrol:motocontrol@localhost:5432/motocontrol_test';
process.env.BACKUP_DIR = require('path').join(require('os').tmpdir(), 'motocontrol-test-backups');
process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { pool } = require('../server/config/db');
const { migrate } = require('../database/migrate');
const { createApp } = require('../app');

async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  const hash = await bcrypt.hash('senha123', 4);
  for (const [name, username, role] of [
    ['Admin', 'admin', 'admin'], ['João', 'joao', 'atendente'], ['Carlos', 'carlos', 'mecanico'],
    ['Paulo', 'paulo', 'mecanico'], ['Ana', 'ana', 'consulta'],
  ]) {
    await pool.query(
      'INSERT INTO users (role_id, name, username, password_hash) SELECT id, $1, $2, $3 FROM roles WHERE code = $4',
      [name, username, hash, role]);
  }
}

async function login(app, username) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password: 'senha123' });
  if (res.status !== 200) throw new Error(`login ${username} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

module.exports = { request, pool, resetDb, login, createApp };
