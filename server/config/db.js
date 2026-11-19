const { Pool, types } = require('pg');
const env = require('./env');

// DATE como string 'YYYY-MM-DD' (evita deslocamento de fuso) e NUMERIC como número.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const pool = new Pool({ connectionString: env.databaseUrl, max: 20 });

/** Executa fn dentro de uma transação, entregando um client dedicado. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (text, params) => pool.query(text, params), withTransaction };
