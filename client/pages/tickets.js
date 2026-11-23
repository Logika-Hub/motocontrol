import { api, qs } from '../scripts/api.js';
import { html, raw, fmtPlate, fmtDateTime, statusBadge } from '../scripts/ui.js';
import { hashQuery } from '../scripts/app.js';

const FILTERS = [['aberto', 'Abertos'], ['encerrado', 'Encerrados'], ['todos', 'Todos']];
const LIMIT = 30;
const POLL_MS = 20000;

/** Fila de chamados (D18): os do lado do usuário (balcão ou oficina), os que abriu e os em que escreveu. */
export async function render(el, _p, ctx) {
  const q = hashQuery();
  const state = { status: FILTERS.some(([k]) => k === q.status) ? q.status : 'aberto', page: 1 };
  const myHash = location.hash;
  const side = ctx.user.role === 'mecanico'
    ? 'Chamados abertos pelo balcão para a oficina, e os que você abriu ou respondeu.'
    : 'Chamados abertos pelos mecânicos para o balcão, e os que você abriu ou respondeu.';

  el.innerHTML = html`
    <div class="page-head"><div><h1>Chamados</h1><p class="muted small">${side} Para abrir um chamado, entre na comanda da moto.</p></div></div>
    <div class="card">
      <div class="segmented" role="tablist">${FILTERS.map(([k, l]) => raw(html`<button class="btn btn-sm ${k === state.status ? 'btn-primary' : 'btn-ghost'}" data-filter="${k}">${l}</button>`))}</div>
      <div data-list><p class="loading">Carregando…</p></div>
    </div>`;
  const list = el.querySelector('[data-list]');

  async function load() {
    const d = await api.get(`/tickets${qs({ status: state.status, page: state.page, limit: LIMIT })}`);
    if (!el.isConnected) return;
    list.innerHTML = d.data.length ? html`
      <ul class="ticket-list">${d.data.map((t) => raw(html`
        <li class="${t.unread ? 'has-unread' : ''}">
          <a href="#/comandas/${t.work_order_id}">
            <div class="ticket-line">
              <b>${t.code}</b> <span class="muted">${t.brand} ${t.model}</span> <span class="plate">${fmtPlate(t.plate)}</span>
              ${raw(statusBadge(t.work_order_status))}
              ${t.unread ? raw(html`<span class="count-badge" title="Mensagens não lidas">${t.unread}</span>`) : ''}
              <time class="muted small">${fmtDateTime(t.last_at || t.created_at)}</time>
            </div>
            <div class="small">Chamado #${t.id} para ${t.target_label} · aberto por ${t.opened_by_name}
              ${t.status === 'encerrado' ? raw('<span class="tag">encerrado</span>') : ''}</div>
            <div class="ticket-last muted small">${t.last_user_name ? `${t.last_user_name}: ` : ''}${t.status === 'encerrado' && t.summary ? `Resumo: ${t.summary}` : (t.last_body || '')}</div>
          </a>
        </li>`))}</ul>
      ${state.page > 1 || d.data.length === LIMIT ? raw(html`<nav class="pager">
        <button class="btn btn-ghost btn-sm" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
        <span class="muted small">Página ${state.page}</span>
        <button class="btn btn-ghost btn-sm" data-page="${state.page + 1}" ${d.data.length < LIMIT ? 'disabled' : ''}>Próxima ›</button>
      </nav>`) : ''}`
      : `<p class="empty">${state.status === 'aberto' ? 'Nenhum chamado aberto.' : 'Nenhum chamado encontrado.'}</p>`;
  }

  el.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      state.status = f.dataset.filter; state.page = 1;
      el.querySelectorAll('[data-filter]').forEach((b) => {
        b.classList.toggle('btn-primary', b === f); b.classList.toggle('btn-ghost', b !== f);
      });
      load().catch(() => {});
      return;
    }
    const pg = e.target.closest('[data-page]');
    if (pg && !pg.disabled) { state.page = Number(pg.dataset.page); load().catch(() => {}); }
  });

  const timer = setInterval(() => {
    if (!el.isConnected || location.hash !== myHash) { clearInterval(timer); return; }
    if (!document.hidden) load().catch(() => {});
  }, POLL_MS);

  await load();
}
