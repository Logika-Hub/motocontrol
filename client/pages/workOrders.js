import { api, qs } from '../scripts/api.js';
import { html, raw, fmtPlate, fmtDateTime, fmtDate, statusBadge, pager, STATUS_LABELS, formData } from '../scripts/ui.js';
import { hashQuery } from '../scripts/app.js';

export async function render(el, _p, ctx) {
  const initial = hashQuery();
  const state = { page: 1, ...initial };
  const staff = await api.get('/admin/staff');
  const multiStatus = (state.status || '').includes(',');

  el.innerHTML = html`
    <div class="page-head">
      <h1>Comandas</h1>
      ${ctx.can('work_orders:create') ? raw('<a class="btn btn-primary" href="#/comandas/nova">+ Nova comanda</a>') : ''}
    </div>
    <div class="card">
      <form class="filters grid-filters" data-filters>
        <input name="number" placeholder="Nº (OS-000123)" value="${state.number || ''}">
        <input name="plate" placeholder="Placa" class="upper" value="${state.plate || ''}">
        <input name="customer" placeholder="Cliente" value="${state.customer || ''}">
        <input name="model" placeholder="Modelo" value="${state.model || ''}">
        <select name="status">
          <option value="">Todos os status</option>
          <option value="aberta,em_diagnostico,aguardando_pecas,em_execucao" ${multiStatus ? 'selected' : ''}>Em andamento</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => raw(html`<option value="${k}" ${state.status === k ? 'selected' : ''}>${v}</option>`))}
        </select>
        <select name="userId">
          <option value="">Qualquer funcionário</option>
          ${staff.map((u) => raw(html`<option value="${u.id}" ${String(u.id) === state.userId ? 'selected' : ''}>${u.name} (${u.role_name})</option>`))}
        </select>
        <label class="inline">De <input type="date" name="from" value="${state.from || ''}"></label>
        <label class="inline">Até <input type="date" name="to" value="${state.to || ''}"></label>
        <div class="filter-actions"><button class="btn btn-primary btn-sm" type="submit">Filtrar</button>
        <button class="btn btn-ghost btn-sm" type="reset" data-clear>Limpar</button></div>
      </form>
      <div data-list></div>
    </div>`;

  const list = el.querySelector('[data-list]');
  const form = el.querySelector('[data-filters]');

  async function load() {
    const d = await api.get(`/work-orders${qs(state)}`);
    list.innerHTML = d.items.length ? html`
      <table class="table">
        <thead><tr><th>Comanda</th><th>Motocicleta</th><th>Cliente</th><th class="hide-sm">Abertura</th><th class="hide-sm">Previsão</th><th>Status</th></tr></thead>
        <tbody>${d.items.map((w) => raw(html`
          <tr data-href="#/comandas/${w.id}">
            <td><a href="#/comandas/${w.id}"><b>${w.code}</b></a><br><small class="muted">${w.opened_by_name}</small></td>
            <td>${w.brand} ${w.model}<br><small class="plate">${fmtPlate(w.plate)}</small></td>
            <td>${w.customer_name}</td>
            <td class="hide-sm">${fmtDateTime(w.opened_at)}</td>
            <td class="hide-sm">${fmtDate(w.expected_delivery)}</td>
            <td>${raw(statusBadge(w.status))}</td>
          </tr>`))}</tbody>
      </table>${raw(pager(d.page, d.limit, d.total))}` : '<p class="empty">Nenhuma comanda encontrada.</p>';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(state, formData(form), { page: 1 });
    load().catch((err) => { list.innerHTML = `<p class="empty">${err.message}</p>`; });
  });
  form.addEventListener('reset', () => {
    for (const k of Object.keys(state)) delete state[k];
    state.page = 1;
    setTimeout(load);
  });
  list.addEventListener('click', (e) => {
    const pg = e.target.closest('[data-page]');
    if (pg) { state.page = Number(pg.dataset.page); load(); return; }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  await load();
}
