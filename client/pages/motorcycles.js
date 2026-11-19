import { api, qs } from '../scripts/api.js';
import { html, raw, fmtPlate, fmtKm, statusBadge, pager, debounce } from '../scripts/ui.js';
import { motorcycleModal } from '../scripts/forms.js';

export async function render(el, _p, ctx) {
  const state = { q: '', page: 1 };
  el.innerHTML = html`
    <div class="page-head">
      <h1>Motocicletas</h1>
      ${ctx.can('motorcycles:write') ? raw('<button class="btn btn-primary" data-new>+ Nova motocicleta</button>') : ''}
    </div>
    <div class="card">
      <div class="filters"><input type="search" data-q placeholder="Pesquisar por placa, modelo, marca ou proprietário" autofocus></div>
      <div data-list></div>
    </div>`;
  const list = el.querySelector('[data-list]');

  async function load() {
    const d = await api.get(`/motorcycles${qs({ q: state.q, page: state.page })}`);
    list.innerHTML = d.items.length ? html`
      <table class="table">
        <thead><tr><th>Placa</th><th>Motocicleta</th><th class="hide-sm">Ano</th><th>Proprietário</th><th class="hide-sm">Km</th><th class="hide-sm">Última comanda</th></tr></thead>
        <tbody>${d.items.map((m) => raw(html`
          <tr data-href="#/motos/${m.id}"><td><a class="plate" href="#/motos/${m.id}">${fmtPlate(m.plate)}</a></td>
          <td>${m.brand} ${m.model}</td><td class="hide-sm">${m.year}</td>
          <td>${m.customer_name}</td><td class="hide-sm">${fmtKm(m.current_km)}</td>
          <td class="hide-sm">${m.last_status ? raw(statusBadge(m.last_status)) : '—'}</td></tr>`))}</tbody>
      </table>${raw(pager(d.page, d.limit, d.total))}` : '<p class="empty">Nenhuma motocicleta encontrada.</p>';
  }

  el.querySelector('[data-q]').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 1; load(); }));
  list.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg) { state.page = Number(pg.dataset.page); load(); return; }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  const btn = el.querySelector('[data-new]');
  if (btn) btn.addEventListener('click', async () => { const m = await motorcycleModal(); if (m) ctx.navigate(`/motos/${m.id}`); });
  await load();
}
