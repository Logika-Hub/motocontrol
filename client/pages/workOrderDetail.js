import { api } from '../scripts/api.js';
import {
  html, raw, field, modal, confirmDialog, toast, showError, statusBadge, STATUS_LABELS,
  fmtDateTime, fmtDate, fmtTime, fmtKm, fmtPlate, fmtPhone,
} from '../scripts/ui.js';

const ACTIVE = ['aberta', 'em_diagnostico', 'aguardando_pecas', 'em_execucao'];
const TYPE_LABELS = {
  abertura: 'Abertura', status: 'Status', diagnostico: 'Diagnóstico', servico: 'Serviço', peca: 'Peça',
  observacao: 'Observação', edicao: 'Edição', correcao: 'Correção', finalizacao: 'Finalização',
  cancelamento: 'Cancelamento', remocao: 'Remoção',
};
const MANUAL = ['observacao', 'diagnostico', 'servico', 'correcao'];

export async function render(el, [id], ctx) {
  let wo = await api.get(`/work-orders/${id}`);

  // Executa uma ação; em conflito de versão (outro usuário alterou), recarrega a comanda.
  async function act(fn, okMsg) {
    try {
      wo = await fn();
      if (okMsg) toast(okMsg);
      draw();
      return wo;
    } catch (err) {
      if (err.status === 409 && err.details && err.details.currentVersion) {
        toast(err.message, 'error');
        wo = await api.get(`/work-orders/${id}`);
        draw();
        return null;
      }
      throw err;
    }
  }

  function draw() {
    const open = ACTIVE.includes(wo.status);
    const canEdit = open && (ctx.can('work_orders:edit_reception') || ctx.can('work_orders:edit_technical'));
    const updateTypes = [
      ctx.can('work_orders:diagnosis') && ['servico', 'Serviço executado'],
      ctx.can('work_orders:diagnosis') && ['diagnostico', 'Diagnóstico'],
      ctx.can('work_orders:note') && ['observacao', 'Observação'],
    ].filter(Boolean);

    el.innerHTML = html`
      <div class="page-head">
        <div><a class="back" href="#/comandas">‹ Comandas</a>
          <h1>${wo.code} ${raw(statusBadge(wo.status))}</h1>
          <p class="muted small">Aberta em ${fmtDateTime(wo.opened_at)} por ${wo.opened_by_name}
            ${wo.closed_at ? raw(html` · ${wo.status === 'cancelada' ? 'Cancelada' : 'Concluída'} em ${fmtDateTime(wo.closed_at)} por ${wo.closed_by_name}`) : ''}</p>
        </div>
        <div class="actions">
          ${open && ctx.can('work_orders:status') ? raw(html`
            <label class="inline status-select">Status
              <select data-status>${ACTIVE.map((s) => raw(html`<option value="${s}" ${s === wo.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`))}</select>
            </label>`) : ''}
          ${open && ctx.can('work_orders:finish') ? raw('<button class="btn btn-success" data-finish>Concluir</button>') : ''}
          ${open && ctx.can('work_orders:cancel') ? raw('<button class="btn btn-ghost danger" data-cancel>Cancelar</button>') : ''}
          <button class="btn btn-ghost" data-print>Imprimir</button>
        </div>
      </div>

      ${wo.status === 'cancelada' ? raw(html`<p class="alert alert-danger"><b>Justificativa do cancelamento:</b> ${wo.cancel_reason}</p>`) : ''}
      ${wo.status === 'concluida' && wo.closing_notes ? raw(html`<p class="alert alert-ok"><b>Observações finais:</b> ${wo.closing_notes}</p>`) : ''}

      <div class="grid-2">
        <section class="card">
          <h2>Cliente e motocicleta</h2>
          <dl class="info">
            <div><dt>Proprietário</dt><dd><a href="#/clientes/${wo.customer_id}">${wo.customer_name}</a></dd></div>
            <div><dt>Telefone</dt><dd>${fmtPhone(wo.customer_phone)}</dd></div>
            <div><dt>Motocicleta</dt><dd><a href="#/motos/${wo.motorcycle_id}">${wo.brand} ${wo.model}</a> · ${wo.year}${wo.color ? ` · ${wo.color}` : ''}</dd></div>
            <div><dt>Placa</dt><dd><span class="plate">${fmtPlate(wo.plate)}</span></dd></div>
            <div><dt>Km na entrada</dt><dd>${fmtKm(wo.entry_km)}</dd></div>
            <div><dt>Previsão de entrega</dt><dd>${fmtDate(wo.expected_delivery)}</dd></div>
          </dl>
        </section>
        <section class="card">
          <div class="card-head"><h2>Atendimento</h2>${canEdit ? raw('<button class="btn btn-ghost btn-sm" data-edit>Editar</button>') : ''}</div>
          <dl class="info info-stack">
            <div><dt>Reclamação do cliente</dt><dd class="pre">${wo.complaint}</dd></div>
            <div><dt>Problemas identificados</dt><dd class="pre">${wo.identified_problems || '—'}</dd></div>
            <div><dt>Diagnóstico</dt><dd class="pre">${wo.diagnosis || '—'}</dd></div>
            <div><dt>Observações</dt><dd class="pre">${wo.notes || '—'}</dd></div>
          </dl>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2>Serviços e peças</h2>
          ${open && ctx.can('work_orders:items') ? raw('<button class="btn btn-primary btn-sm" data-add-item>+ Adicionar</button>') : ''}</div>
        ${wo.items.length ? raw(html`<table class="table">
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd.</th><th>Situação</th><th></th></tr></thead>
          <tbody>${wo.items.map((i) => raw(html`<tr>
            <td>${i.kind === 'peca' ? 'Peça' : 'Serviço'}</td>
            <td>${i.description}<br><small class="muted">por ${i.created_by_name}</small></td>
            <td>${i.quantity}</td>
            <td>${i.status === 'realizado'
    ? raw(html`<span class="badge status-concluida">${i.kind === 'peca' ? 'Aplicada' : 'Realizado'}</span><br><small class="muted">${i.performed_by_name} · ${fmtDateTime(i.performed_at)}</small>`)
    : raw(html`<span class="badge">${i.kind === 'peca' ? 'Solicitada' : 'Solicitado'}</span>`)}</td>
            <td class="right nowrap">${open && ctx.can('work_orders:items') ? raw(html`
              ${i.status !== 'realizado' ? raw(html`<button class="btn btn-sm btn-ghost" data-item-done="${i.id}">✓ ${i.kind === 'peca' ? 'Aplicada' : 'Realizado'}</button>`) : ''}
              <button class="btn btn-sm btn-ghost danger" data-item-remove="${i.id}" aria-label="Remover">Remover</button>`) : ''}</td>
          </tr>`))}</tbody></table>`) : raw('<p class="empty">Nenhum serviço ou peça registrado.</p>')}
      </section>

      <section class="card">
        <h2>Histórico de atividades</h2>
        ${open && updateTypes.length ? raw(html`
          <form class="timeline-form" data-update-form>
            <select name="type">${updateTypes.map(([v, l]) => raw(html`<option value="${v}">${l}</option>`))}</select>
            <textarea name="description" rows="2" placeholder="Descreva a atividade realizada…" required></textarea>
            <button class="btn btn-primary" type="submit">Registrar</button>
          </form>`) : ''}
        <ol class="timeline">${[...wo.updates].reverse().map((u) => raw(timelineItem(u, open)))}</ol>
      </section>`;
    bind();
  }

  function timelineItem(u, open) {
    const canCorrect = MANUAL.includes(u.type) && !u.removed_at && (open || ctx.user.role === 'admin')
      && (u.user_id === ctx.user.id || ctx.user.role === 'admin');
    const canRemove = MANUAL.includes(u.type) && !u.removed_at && ctx.can('work_orders:remove_update');
    const original = u.corrects_update_id ? wo.updates.find((x) => x.id === u.corrects_update_id) : null;
    return html`<li class="tl tl-${u.type} ${u.removed_at ? 'tl-removed' : ''} ${u.corrected ? 'tl-corrected' : ''}">
      <div class="tl-meta">
        <time title="${fmtDateTime(u.created_at)}">${fmtDateTime(u.created_at)}</time>
        <b>${u.user_name}</b> <span class="muted">(${u.user_role})</span>
        <span class="tag">${TYPE_LABELS[u.type] || u.type}</span>
        ${u.corrected ? raw('<span class="tag tag-warn">corrigido</span>') : ''}
      </div>
      <div class="tl-text pre">${u.description}</div>
      ${original ? raw(html`<div class="muted small">Corrige o registro de ${fmtTime(original.created_at)}: “${original.description}”</div>`) : ''}
      ${u.removed_at ? raw(html`<div class="muted small">Removido por ${u.removed_by_name} em ${fmtDateTime(u.removed_at)} — ${u.removed_reason}</div>`) : ''}
      ${canCorrect || canRemove ? raw(html`<div class="tl-actions">
        ${canCorrect ? raw(html`<button class="link" data-correct="${u.id}">Corrigir</button>`) : ''}
        ${canRemove ? raw(html`<button class="link danger" data-remove="${u.id}">Remover</button>`) : ''}
      </div>`) : ''}
    </li>`;
  }

  function bind() {
    const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach((b) => b.addEventListener(ev, (e) => fn(e, b)));
    const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { showError(err); draw(); } };

    on('[data-print]', 'click', () => window.print());

    on('[data-status]', 'change', guard(async (_e, sel) => {
      await act(() => api.post(`/work-orders/${id}/status`, { status: sel.value, version: wo.version }),
        `Status alterado para "${STATUS_LABELS[sel.value]}".`);
    }));

    on('[data-finish]', 'click', () => modal({
      title: `Concluir ${wo.code}`,
      body: field('Observações finais', '<textarea name="closingNotes" rows="3" placeholder="Opcional"></textarea>'),
      submitLabel: 'Concluir comanda',
      onSubmit: (d) => act(() => api.post(`/work-orders/${id}/finish`, { ...d, version: wo.version }), 'Comanda concluída.'),
    }));

    on('[data-cancel]', 'click', () => modal({
      title: `Cancelar ${wo.code}`,
      body: field('Justificativa', '<textarea name="reason" rows="3" required></textarea>', { required: true }),
      submitLabel: 'Cancelar comanda',
      danger: true,
      onSubmit: (d) => act(() => api.post(`/work-orders/${id}/cancel`, { ...d, version: wo.version }), 'Comanda cancelada.'),
    }));

    on('[data-edit]', 'click', () => {
      const rec = ctx.can('work_orders:edit_reception');
      const tech = ctx.can('work_orders:edit_technical');
      const parts = [];
      if (rec) {
        parts.push(field('Reclamação do cliente', html`<textarea name="complaint" rows="2" required>${wo.complaint}</textarea>`, { required: true }));
        parts.push(html`<div class="row">${raw(field('Km na entrada', html`<input name="entryKm" type="number" min="0" value="${wo.entry_km ?? ''}">`))}
          ${raw(field('Previsão de entrega', html`<input name="expectedDelivery" type="date" value="${wo.expected_delivery || ''}">`))}</div>`);
      }
      if (tech) {
        parts.push(field('Problemas identificados', html`<textarea name="identifiedProblems" rows="2">${wo.identified_problems || ''}</textarea>`));
        parts.push(field('Diagnóstico', html`<textarea name="diagnosis" rows="3">${wo.diagnosis || ''}</textarea>`));
      }
      parts.push(field('Observações', html`<textarea name="notes" rows="2">${wo.notes || ''}</textarea>`));
      modal({
        title: 'Editar atendimento',
        body: parts.join('') + '<p class="muted small">As alterações ficam registradas no histórico com o valor anterior.</p>',
        onSubmit: (d) => act(() => api.patch(`/work-orders/${id}`, { ...d, version: wo.version }), 'Comanda atualizada.'),
      });
    });

    on('[data-add-item]', 'click', () => modal({
      title: 'Adicionar serviço ou peça',
      body: html`<div class="row">
          ${raw(field('Tipo', '<select name="kind"><option value="servico">Serviço</option><option value="peca">Peça</option></select>'))}
          ${raw(field('Quantidade', '<input name="quantity" type="number" min="0.01" step="0.01" value="1">'))}
        </div>${raw(field('Descrição', '<input name="description" required maxlength="255">', { required: true }))}`,
      submitLabel: 'Adicionar',
      onSubmit: (d) => act(() => api.post(`/work-orders/${id}/items`, d), 'Item adicionado.'),
    }));

    on('[data-item-done]', 'click', guard(async (_e, b) => {
      await act(() => api.post(`/work-orders/${id}/items/${b.dataset.itemDone}/done`), 'Item marcado como realizado.');
    }));

    on('[data-item-remove]', 'click', guard(async (_e, b) => {
      if (!(await confirmDialog('Remover item', 'Remover este item da comanda? A remoção fica registrada no histórico.', { submitLabel: 'Remover' }))) return;
      await act(() => api.del(`/work-orders/${id}/items/${b.dataset.itemRemove}`), 'Item removido.');
    }));

    on('[data-update-form]', 'submit', guard(async (e, form) => {
      e.preventDefault();
      const description = form.description.value.trim();
      if (!description) return;
      form.querySelector('button').disabled = true;
      await act(() => api.post(`/work-orders/${id}/updates`, { type: form.type.value, description }), 'Atividade registrada.');
    }));

    on('[data-correct]', 'click', (_e, b) => {
      const u = wo.updates.find((x) => x.id === Number(b.dataset.correct));
      modal({
        title: 'Corrigir registro',
        body: html`<p class="muted small">O registro original será mantido e marcado como corrigido.</p>
          ${raw(field('Texto corrigido', html`<textarea name="description" rows="3" required>${u.description}</textarea>`))}`,
        onSubmit: (d) => act(() => api.post(`/work-orders/${id}/updates/${u.id}/correct`, d), 'Correção registrada.'),
      });
    });

    on('[data-remove]', 'click', (_e, b) => modal({
      title: 'Remover registro',
      body: html`<p class="muted small">O registro deixará de contar no histórico, mas permanece guardado e a remoção é auditada.</p>
        ${raw(field('Motivo', '<textarea name="reason" rows="2" required></textarea>', { required: true }))}`,
      submitLabel: 'Remover',
      danger: true,
      onSubmit: (d) => act(() => api.del(`/work-orders/${id}/updates/${b.dataset.remove}`, d), 'Registro removido.'),
    }));
  }

  draw();
}
