const { query } = require('../config/db');

/** Registra uma operação na auditoria (RNF09). Aceita um client de transação. */
async function audit(db, { userId = null, action, entity, entityId = null, details = null, ip = null }) {
  const runner = db || { query };
  await runner.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, action, entity, entityId, details ? JSON.stringify(details) : null, ip],
  );
}

module.exports = { audit };
