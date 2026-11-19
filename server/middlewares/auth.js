const { query } = require('../config/db');
const { can } = require('../config/permissions');
const { AppError, forbidden } = require('../errors');

/**
 * Carrega o usuário da sessão a cada requisição, para que desativação de conta
 * e mudança de perfil tenham efeito imediato.
 */
async function loadUser(req, _res, next) {
  try {
    if (!req.session || !req.session.userId) return next();
    const { rows } = await query(
      `SELECT u.id, u.name, u.username, u.active, u.must_change_password, r.code AS role, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [req.session.userId],
    );
    const user = rows[0];
    if (!user || !user.active) {
      req.session.destroy(() => {});
      return next();
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'Sessão expirada ou não autenticada.'));
  next();
}

function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'Sessão expirada ou não autenticada.'));
    if (!permissions.some((p) => can(req.user.role, p))) return next(forbidden());
    next();
  };
}

module.exports = { loadUser, requireAuth, requirePermission };
