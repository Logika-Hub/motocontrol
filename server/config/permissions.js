/**
 * Matriz de permissões por perfil (briefing 4.1).
 * Verificada no back-end em todas as rotas; a interface apenas reflete esta matriz.
 */
const PERMISSIONS = {
  // inclui permissões exclusivas: users:manage, backups:manage, settings:manage e as financeiras de administração
  // (D19): finance:admin (visão geral, equipe, repasses), commissions:manage (regras) e sales:void (estorno).
  admin: ['*'],
  atendente: [
    'dashboard:read',
    'customers:read', 'customers:write',
    'motorcycles:read', 'motorcycles:write',
    'work_orders:read', 'work_orders:create', 'work_orders:edit_reception',
    'work_orders:note', 'work_orders:status', 'work_orders:finish', 'work_orders:cancel',
    'tickets:use', // D18: abrir/responder/encerrar chamados
    'sales:close', 'sales:read', // D19: fechar a venda da comanda e consultar o histórico de vendas
    'finance:own',               // D19: painel individual (somente os próprios dados)
  ],
  mecanico: [
    'dashboard:read',
    'customers:read', 'motorcycles:read',
    'work_orders:read', 'work_orders:edit_technical', 'work_orders:note',
    'work_orders:diagnosis', 'work_orders:items', 'work_orders:status', 'work_orders:finish',
    'tickets:use',
    'finance:own', // D19: painel individual (somente os próprios dados)
  ],
  consulta: ['dashboard:read', 'customers:read', 'motorcycles:read', 'work_orders:read'],
};

function can(roleCode, permission) {
  const perms = PERMISSIONS[roleCode] || [];
  return perms.includes('*') || perms.includes(permission);
}

module.exports = { PERMISSIONS, can };
