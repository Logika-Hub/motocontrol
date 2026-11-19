const { AppError } = require('../lib/errors');

const PG_MESSAGES = {
  '23505': 'Já existe um registro com estes dados.',
  '23503': 'Operação viola um relacionamento entre registros.',
  '23514': 'Dados inválidos para esta operação.',
  '22P02': 'Formato de dado inválido.',
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  if (err.code && PG_MESSAGES[err.code]) {
    const status = err.code === '23505' || err.code === '23503' ? 409 : 400;
    return res.status(status).json({ error: PG_MESSAGES[err.code], details: { constraint: err.constraint } });
  }
  console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = errorHandler;
