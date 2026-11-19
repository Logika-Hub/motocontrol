import { api, qs } from '../scripts/api.js';
import { html, raw, fmtPhone, fmtCpf, pager, debounce } from '../scripts/ui.js';
import { customerModal } from '../scripts/forms.js';

export async function render(el, _p, ctx) {
  const state = { q: '', page: 1 };
  el.innerHTML = html`
    <div class="page-head">
      <h1>Clientes</h1>
      ${ctx.can('customers:write') ? raw('<button class="btn btn-primary" data-new>+ Novo cliente</button>') : ''}
    </div>
    <div class="card">
      <div class="filters"><input type="search" data-q placeholder="Pesquisar por nome, telefone ou CPF" autofocus></div>
      <div data-list></div>
    </div>`;
  const list = el.querySelector('[data-list]');

  async function load() {
    const d = await api.get(`/customers${qs({ q: state.q, page: state.page })}`);
    list.innerHTML = d.items.length ? html`
      <table class="table">
        <thead><tr><th>Nome</th><th>Telefone</th><th class="hide-sm">CPF</th><th>Motos</th></tr></thead>
        <tbody>${d.items.map((c) => raw(html`
          <tr data-href="#/clientes/${c.id}"><td><a href="#/clientes/${c.id}">${c.name}</a></td>
          <td>${fmtPhone(c.phone)}</td><td class="hide-sm">${fmtCpf(c.cpf)}</td><td>${c.motorcycles_count}</td></tr>`))}</tbody>
      </table>${raw(pager(d.page, d.limit, d.total))}` : '<p class="empty">Nenhum cliente encontrado.</p>';
  }

  el.querySelector('[data-q]').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; load(); }));
  list.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg) { state.page = Number(pg.dataset.page); load(); return; }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  const btn = el.querySelector('[data-new]');
  if (btn) btn.addEventListener('click', async () => { const c = await customerModal(); if (c) ctx.navigate(`/clientes/${c.id}`); });
  await load();
}
