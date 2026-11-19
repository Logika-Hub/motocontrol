import { api } from '../scripts/api.js';
import { html, raw, fmtPhone, fmtCpf, fmtKm, fmtPlate, fmtDateTime, statusBadge, confirmDialog, toast, showError } from '../scripts/ui.js';
import { customerModal, motorcycleModal } from '../scripts/forms.js';

export async function render(el, [id], ctx) {
  const c = await api.get(`/customers/${id}`);
  el.innerHTML = html`
    <div class="page-head">
      <div><a class="back" href="#/clientes">‹ Clientes</a><h1>${c.name}</h1></div>
      <div class="actions">
        ${ctx.can('customers:write') ? raw('<button class="btn btn-ghost" data-edit>Editar</button>') : ''}
        ${ctx.can('customers:delete') ? raw('<button class="btn btn-ghost danger" data-delete>Excluir</button>') : ''}
      </div>
    </div>
    <section class="card">
      <dl class="info">
        <div><dt>Telefone</dt><dd>${fmtPhone(c.phone)}</dd></div>
        <div><dt>CPF</dt><dd>${fmtCpf(c.cpf)}</dd></div>
        <div><dt>Endereço</dt><dd>${c.address || '—'}</dd></div>
        <div><dt>Cadastrado em</dt><dd>${fmtDateTime(c.created_at)}</dd></div>
      </dl>
      ${c.notes ? raw(html`<p class="notes">${c.notes}</p>`) : ''}
    </section>
    <section class="card">
      <div class="card-head"><h2>Motocicletas</h2>
        ${ctx.can('motorcycles:write') ? raw('<button class="btn btn-sm btn-primary" data-new-moto>+ Motocicleta</button>') : ''}</div>
      ${c.motorcycles.length ? raw(html`<table class="table"><thead><tr><th>Placa</th><th>Motocicleta</th><th>Ano</th><th class="hide-sm">Km</th><th></th></tr></thead>
        <tbody>${c.motorcycles.map((m) => raw(html`<tr>
          <td><a class="plate" href="#/motos/${m.id}">${fmtPlate(m.plate)}</a></td><td>${m.brand} ${m.model}</td><td>${m.year}</td>
          <td class="hide-sm">${fmtKm(m.current_km)}</td>
          <td class="right">${ctx.can('work_orders:create') ? raw(html`<a class="btn btn-sm btn-ghost" href="#/comandas/nova?moto=${m.id}">Abrir comanda</a>`) : ''}</td>
        </tr>`))}</tbody></table>`) : raw('<p class="empty">Nenhuma motocicleta cadastrada.</p>')}
    </section>
    <section class="card">
      <h2>Histórico de comandas</h2>
      ${c.workOrders.length ? raw(html`<table class="table"><thead><tr><th>Comanda</th><th>Motocicleta</th><th>Abertura</th><th>Status</th></tr></thead>
        <tbody>${c.workOrders.map((w) => raw(html`<tr>
          <td><a href="#/comandas/${w.id}"><b>OS-${String(w.number).padStart(6, '0')}</b></a></td>
          <td>${w.brand} ${w.model} <small class="plate">${fmtPlate(w.plate)}</small></td>
          <td>${fmtDateTime(w.opened_at)}</td><td>${raw(statusBadge(w.status))}</td></tr>`))}</tbody></table>`)
        : raw('<p class="empty">Nenhuma comanda registrada.</p>')}
    </section>`;

  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
  on('[data-edit]', async () => { if (await customerModal(c)) ctx.refresh(); });
  on('[data-new-moto]', async () => { if (await motorcycleModal(null, { id: c.id, name: c.name })) ctx.refresh(); });
  on('[data-delete]', async () => {
    if (!(await confirmDialog('Excluir cliente', `Excluir o cadastro de ${c.name}? Clientes com comandas não podem ser excluídos.`, { submitLabel: 'Excluir' }))) return;
    try {
      await api.del(`/customers/${c.id}`);
      toast('Cliente excluído.');
      ctx.navigate('/clientes');
    } catch (err) { showError(err); }
  });
}
