import { api, setUnauthorizedHandler } from './api.js';
import { html, raw, esc, showError } from './ui.js';

const routes = [
  { path: /^\/$/, page: 'dashboard', perm: 'dashboard:read' },
  { path: /^\/comandas$/, page: 'workOrders', perm: 'work_orders:read' },
  { path: /^\/comandas\/nova$/, page: 'workOrderNew', perm: 'work_orders:create' },
  { path: /^\/comandas\/(\d+)$/, page: 'workOrderDetail', perm: 'work_orders:read' },
  { path: /^\/clientes$/, page: 'customers', perm: 'customers:read' },
  { path: /^\/clientes\/(\d+)$/, page: 'customerDetail', perm: 'customers:read' },
  { path: /^\/motos$/, page: 'motorcycles', perm: 'motorcycles:read' },
  { path: /^\/motos\/(\d+)$/, page: 'motorcycleDetail', perm: 'motorcycles:read' },
  { path: /^\/usuarios$/, page: 'users', perm: 'users:manage' },
  { path: /^\/administracao$/, page: 'admin', perm: 'backups:manage' },
  { path: /^\/senha$/, page: 'password' },
];

const NAV = [
  { href: '#/', label: 'Dashboard', perm: 'dashboard:read', match: /^\/$/ },
  { href: '#/comandas', label: 'Comandas', perm: 'work_orders:read', match: /^\/comandas/ },
  { href: '#/clientes', label: 'Clientes', perm: 'customers:read', match: /^\/clientes/ },
  { href: '#/motos', label: 'Motocicletas', perm: 'motorcycles:read', match: /^\/motos/ },
  { href: '#/usuarios', label: 'Funcionários', perm: 'users:manage', match: /^\/usuarios/ },
  { href: '#/administracao', label: 'Administração', perm: 'backups:manage', match: /^\/administracao/ },
];

const ctx = {
  user: null,
  can(perm) {
    const p = this.user ? this.user.permissions : [];
    return p.includes('*') || p.includes(perm);
  },
  navigate(path) { location.hash = `#${path}`; },
  refresh() { render(); },
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
      <a class="brand" href="#/"><img src="/favicon.svg" alt=""> MotoControl</a>
      <button class="icon-btn menu-toggle" aria-label="Menu" data-menu>☰</button>
      <nav class="nav">
        ${NAV.filter((n) => ctx.can(n.perm)).map((n) => raw(html`<a href="${n.href}" class="${n.match.test(path) ? 'active' : ''}">${n.label}</a>`))}
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
  return root.querySelector('#page');
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  if (!ctx.user) {
    try {
      ctx.user = (await api.get('/auth/me')).user;
    } catch {
      const { renderLogin } = await import('../pages/login.js');
      return renderLogin(root, async (user) => { ctx.user = user; render(); });
    }
  }
  let path = currentPath();
  if (ctx.user.mustChangePassword && path !== '/senha') { ctx.navigate('/senha'); return; }
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
