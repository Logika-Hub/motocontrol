import { api } from '../scripts/api.js';
import { html, raw, fmtPlate, fmtKm, fmtDateTime, fmtPhone, statusBadge, confirmDialog, toast, showError } from '../scripts/ui.js';
import { motorcycleModal } from '../scripts/forms.js';

export async function render(el, [id], ctx) {
  const m = await api.get(`/motorcycles/${id}`);
  const active = m.history.find((w) => !['concluida', 'cancelada'].includes(w.status));
  el.innerHTML = html`
    <div class="page-head">
      <div><a class="back" href="#/motos">‹ Motocicletas</a>
        <h1><span class="plate plate-lg">${fmtPlate(m.plate)}</span> ${m.brand} ${m.model}</h1></div>
      <div class="actions">
        ${ctx.can('work_orders:create') && !active ? raw(html`<a class="btn btn-primary" href="#/comandas/nova?moto=${m.id}">+ Abrir comanda</a>`) : ''}
        ${active ? raw(html`<a class="btn btn-primary" href="#/comandas/${active.id}">Comanda em andamento</a>`) : ''}
        ${ctx.can('motorcycles:write') ? raw('<button class="btn btn-ghost" data-edit>Editar</button>') : ''}
        ${ctx.can('motorcycles:delete') ? raw('<button class="btn btn-ghost danger" data-delete>Excluir</button>') : ''}
      </div>
    </div>
    <section class="card">
      <dl class="info">
        <div><dt>Proprietário</dt><dd><a href="#/clientes/${m.customer_id}">${m.customer_name}</a><br><small>${fmtPhone(m.customer_phone)}</small></dd></div>
        <div><dt>Ano</dt><dd>${m.year}</dd></div>
        <div><dt>Cor</dt><dd>${m.color || '—'}</dd></div>
        <div><dt>Quilometragem atual</dt><dd>${fmtKm(m.current_km)}</dd></div>
      </dl>
      ${m.notes ? raw(html`<p class="notes">${m.notes}</p>`) : ''}
    </section>
    <section class="card">
      <h2>Histórico de manutenção</h2>
      ${m.history.length ? raw(html`<ol class="history">${m.history.map((w) => raw(html`
        <li>
          <div class="history-head">
            <a href="#/comandas/${w.id}"><b>OS-${String(w.number).padStart(6, '0')}</b></a>
            ${raw(statusBadge(w.status))}
            <span class="muted small">${fmtDateTime(w.opened_at)} · ${fmtKm(w.entry_km)} · aberta por ${w.opened_by_name}</span>
          </div>
          <p><b>Reclamação:</b> ${w.complaint}</p>
          ${w.diagnosis ? raw(html`<p><b>Diagnóstico:</b> ${w.diagnosis}</p>`) : ''}
          ${w.items.length ? raw(html`<ul class="chips">${w.items.map((i) => raw(html`
            <li class="chip ${i.status === 'realizado' ? 'chip-done' : ''}">${i.kind === 'peca' ? 'Peça' : 'Serviço'}: ${i.description}${i.kind === 'peca' ? ` (${i.quantity})` : ''}</li>`))}</ul>`) : ''}
        </li>`))}</ol>`) : raw('<p class="empty">Nenhuma comanda registrada para esta motocicleta.</p>')}
    </section>`;

  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
  on('[data-edit]', async () => { if (await motorcycleModal(m)) ctx.refresh(); });
  on('[data-delete]', async () => {
    if (!(await confirmDialog('Excluir motocicleta', `Excluir ${fmtPlate(m.plate)}? Motocicletas com comandas não podem ser excluídas.`, { submitLabel: 'Excluir' }))) return;
    try {
      await api.del(`/motorcycles/${m.id}`);
      toast('Motocicleta excluída.');
      ctx.navigate('/motos');
    } catch (err) { showError(err); }
  });
}
