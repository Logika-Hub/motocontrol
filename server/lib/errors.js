class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new AppError(400, msg, details);
const notFound = (msg = 'Registro não encontrado.') => new AppError(404, msg);
const conflict = (msg, details) => new AppError(409, msg, details);
const forbidden = (msg = 'Você não tem permissão para esta operação.') => new AppError(403, msg);

module.exports = { AppError, badRequest, notFound, conflict, forbidden };
