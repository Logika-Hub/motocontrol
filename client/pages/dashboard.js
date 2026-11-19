import { api } from '../scripts/api.js';
import { html, raw, statusBadge, fmtDateTime, fmtTime, fmtPlate } from '../scripts/ui.js';

const CARDS = [
  ['em_andamento', 'Comandas em andamento', '', ''],
  ['aberta', 'Abertas', 'aberta', ''],
  ['em_diagnostico', 'Em diagnóstico', 'em_diagnostico', ''],
  ['aguardando_pecas', 'Aguardando peças', 'aguardando_pecas', ''],
  ['em_execucao', 'Em execução', 'em_execucao', ''],
  ['concluidas_hoje', 'Concluídas hoje', 'concluida', ''],
  ['atrasadas', 'Com entrega atrasada', '', 'warn'],
];

export async function render(el, _p, ctx) {
  const d = await api.get('/dashboard');
  const active = 'aberta,em_diagnostico,aguardando_pecas,em_execucao';
  el.innerHTML = html`
    <div class="page-head">
      <h1>Dashboard</h1>
      ${ctx.can('work_orders:create') ? raw('<a class="btn btn-primary" href="#/comandas/nova">+ Nova comanda</a>') : ''}
    </div>
    <section class="stats">
      ${CARDS.map(([key, label, status, cls]) => raw(html`
        <a class="stat ${cls} ${status ? `stat-${status}` : ''}" href="#/comandas?status=${status || active}">
          <strong>${d.counts[key]}</strong><span>${label}</span>
        </a>`))}
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Últimas comandas</h2>
        ${d.latest.length ? raw(html`<table class="table">
          <thead><tr><th>Comanda</th><th>Motocicleta</th><th>Cliente</th><th>Status</th></tr></thead>
          <tbody>${d.latest.map((w) => raw(html`
            <tr data-href="#/comandas/${w.id}">
              <td><a href="#/comandas/${w.id}"><b>${w.code}</b></a><br><small class="muted">${fmtDateTime(w.opened_at)}</small></td>
              <td>${w.brand} ${w.model}<br><small class="plate">${fmtPlate(w.plate)}</small></td>
              <td>${w.customer_name}</td>
              <td>${raw(statusBadge(w.status))}</td>
            </tr>`))}</tbody></table>`) : raw('<p class="empty">Nenhuma comanda registrada.</p>')}
      </section>
      <section class="card">
        <h2>Atividades recentes</h2>
        ${d.activity.length ? raw(html`<ul class="feed">${d.activity.map((a) => raw(html`
          <li>
            <div class="feed-meta"><b>${a.user_name}</b> <span class="muted">(${a.user_role})</span>
              · <a href="#/comandas/${a.work_order_id}">${a.code}</a> · <span class="plate">${fmtPlate(a.plate)}</span>
              <time title="${fmtDateTime(a.created_at)}">${fmtTime(a.created_at)}</time></div>
            <div>${a.description}</div>
          </li>`))}</ul>`) : raw('<p class="empty">Sem atividades.</p>')}
      </section>
    </div>`;
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = tr.dataset.href;
  }));
}
