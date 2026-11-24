import { api, setUnauthorizedHandler } from './api.js';
import { html, raw, esc, showError } from './ui.js';
import { loadBrand, brandMark } from './brand.js';

const routes = [
  { path: /^\/$/, page: 'dashboard', perm: 'dashboard:read' },
  { path: /^\/comandas$/, page: 'workOrders', perm: 'work_orders:read' },
  { path: /^\/comandas\/nova$/, page: 'workOrderNew', perm: 'work_orders:create' },
  { path: /^\/comandas\/(\d+)$/, page: 'workOrderDetail', perm: 'work_orders:read' },
  { path: /^\/clientes$/, page: 'customers', perm: 'customers:read' },
  { path: /^\/clientes\/(\d+)$/, page: 'customerDetail', perm: 'customers:read' },
  { path: /^\/motos$/, page: 'motorcycles', perm: 'motorcycles:read' },
  { path: /^\/motos\/(\d+)$/, page: 'motorcycleDetail', perm: 'motorcycles:read' },
  { path: /^\/chamados$/, page: 'tickets', perm: 'tickets:use' },
  { path: /^\/vendas$/, page: 'sales', perm: 'sales:read' },
  { path: /^\/meu-painel$/, page: 'myDashboard', perm: 'finance:own' },
  { path: /^\/financeiro$/, page: 'financeAdmin', perm: 'finance:admin' },
  { path: /^\/financeiro\/repasses$/, page: 'payouts', perm: 'finance:admin' },
  { path: /^\/financeiro\/comissoes$/, page: 'commissionRules', perm: 'commissions:manage' },
  { path: /^\/financeiro\/colaborador\/(\d+)$/, page: 'financeCollaborator', perm: 'finance:admin' },
  { path: /^\/usuarios$/, page: 'users', perm: 'users:manage' },
  { path: /^\/administracao$/, page: 'admin', perm: 'backups:manage' },
  { path: /^\/senha$/, page: 'password' },
  { path: /^\/configurar-oficina$/, page: 'setupShop', perm: 'settings:manage' },
];

const NAV = [
  { href: '#/', label: 'Dashboard', perm: 'dashboard:read', match: /^\/$/ },
  { href: '#/comandas', label: 'Comandas', perm: 'work_orders:read', match: /^\/comandas/ },
  { href: '#/chamados', label: 'Chamados', perm: 'tickets:use', match: /^\/chamados/, badge: true },
  { href: '#/vendas', label: 'Vendas', perm: 'sales:read', match: /^\/vendas/ },
  { href: '#/meu-painel', label: 'Meu painel', perm: 'finance:own', match: /^\/meu-painel/ },
  { href: '#/financeiro', label: 'Financeiro', perm: 'finance:admin', match: /^\/financeiro/ },
  { href: '#/clientes', label: 'Clientes', perm: 'customers:read', match: /^\/clientes/ },
  { href: '#/motos', label: 'Motocicletas', perm: 'motorcycles:read', match: /^\/motos/ },
  { href: '#/usuarios', label: 'Funcionários', perm: 'users:manage', match: /^\/usuarios/ },
  { href: '#/administracao', label: 'Administração', perm: 'backups:manage', match: /^\/administracao/ },
];

const ctx = {
  user: null,
  brand: null,
  can(perm) {
    const p = this.user ? this.user.permissions : [];
    return p.includes('*') || p.includes(perm);
  },
  navigate(path) { location.hash = `#${path}`; },
  refresh() { render(); },
  async reloadBrand() { this.brand = await loadBrand(true); render(); },
};

const root = document.getElementById('app');

function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h.split('?')[0] || '/';
}
export function hashQuery() {
  const h = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(h));
}

function layout() {
  const path = currentPath();
  const u = ctx.user;
  root.innerHTML = html`
    <header class="topbar">
      <a class="brand" href="#/" title="MotoControl">${raw(brandMark(ctx.brand, { withName: !!(ctx.brand && ctx.brand.name) }))}</a>
      <button class="icon-btn menu-toggle" aria-label="Menu" data-menu>☰</button>
      <nav class="nav">
        ${NAV.filter((n) => ctx.can(n.perm)).map((n) => raw(html`<a href="${n.href}" class="${n.match.test(path) ? 'active' : ''}">${n.label}${n.badge ? raw('<span class="nav-badge" data-ticket-badge hidden></span>') : ''}</a>`))}
      </nav>
      <div class="user-menu">
        <span class="user-name">${u.name}<small>${u.roleName}</small></span>
        <a class="btn btn-ghost btn-sm" href="/ajuda/" target="_blank" rel="noopener">Ajuda</a>
        <a class="btn btn-ghost btn-sm" href="#/senha">Senha</a>
        <button class="btn btn-ghost btn-sm" data-logout>Sair</button>
      </div>
    </header>
    <main id="page" class="page"></main>`;
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    await api.post('/auth/logout').catch(() => {});
    ctx.user = null;
    if (location.hash && location.hash !== "#/") location.hash = "#/"; else render();
  });
  root.querySelector('[data-menu]').addEventListener('click', () => root.querySelector('.topbar').classList.toggle('open'));
  refreshTicketBadge();
  return root.querySelector('#page');
}

// Aviso de chamados (D18): contador de mensagens não lidas no menu, por consulta periódica (sem push na rede local).
const BADGE_MS = 20000;
let badgeBusy = false;
async function refreshTicketBadge() {
  if (!ctx.user || !ctx.can('tickets:use') || badgeBusy) return;
  badgeBusy = true;
  try {
    const s = await api.get('/tickets/summary');
    const b = root.querySelector('[data-ticket-badge]');
    if (!b || !ctx.user) return;
    b.hidden = !s.unread;
    b.textContent = s.unread > 99 ? '99+' : String(s.unread);
    b.title = `${s.unread} mensagem(ns) não lida(s) em ${s.unread_tickets} chamado(s)`;
  } catch { /* sem rede ou sessão expirada: o próximo ciclo tenta de novo */ } finally { badgeBusy = false; }
}
setInterval(() => { if (!document.hidden) refreshTicketBadge(); }, BADGE_MS);
window.addEventListener('tickets:changed', refreshTicketBadge);

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  if (!ctx.brand) ctx.brand = await loadBrand();
  if (!ctx.user) {
    try {
      ctx.user = (await api.get('/auth/me')).user;
    } catch {
      const { renderLogin } = await import('../pages/login.js');
      return renderLogin(root, ctx.brand, async (user) => { ctx.user = user; render(); });
    }
  }
  let path = currentPath();
  if (ctx.user.mustChangePassword && path !== '/senha') { ctx.navigate('/senha'); return; }
  // Primeiro acesso do admin: pede nome/logo uma única vez (salvar ou pular marca como feito no servidor).
  if (ctx.can('settings:manage') && ctx.brand && ctx.brand.configured === false && path !== '/configurar-oficina') {
    ctx.navigate('/configurar-oficina'); return;
  }
  if (path === '/' && !ctx.can('dashboard:read')) path = '/comandas';

  const route = routes.find((r) => r.path.test(path));
  const container = layout();
  if (!route) { container.innerHTML = '<div class="empty">Página não encontrada.</div>'; return; }
  if (route.perm && !ctx.can(route.perm)) { container.innerHTML = '<div class="empty">Você não tem acesso a esta página.</div>'; return; }
  const params = path.match(route.path).slice(1);
  try {
    const mod = await import(`../pages/${route.page}.js`);
    if (seq !== renderSeq) return;
    await mod.render(container, params, ctx);
  } catch (err) {
    if (seq !== renderSeq) return;
    container.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    if (err.status !== 404) showError(err);
  }
}

setUnauthorizedHandler(() => { if (ctx.user) { ctx.user = null; render(); } });
window.addEventListener('hashchange', render);
render();
