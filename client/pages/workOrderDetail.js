import { api } from '../scripts/api.js';
import {
  html, raw, field, modal, confirmDialog, toast, showError, statusBadge, STATUS_LABELS,
  fmtDateTime, fmtDate, fmtTime, fmtKm, fmtPlate, fmtPhone, fmtMoney,
} from '../scripts/ui.js';
import { openClosing } from '../scripts/closing.js';
import { openSale } from '../scripts/saleDetail.js';

const ACTIVE = ['aberta', 'em_diagnostico', 'aguardando_pecas', 'em_execucao'];
const TYPE_LABELS = {
  abertura: 'Abertura', status: 'Status', diagnostico: 'Diagnóstico', servico: 'Serviço', peca: 'Peça',
  observacao: 'Observação', edicao: 'Edição', correcao: 'Correção', finalizacao: 'Finalização',
  cancelamento: 'Cancelamento', remocao: 'Remoção', chamado: 'Chamado', venda: 'Venda',
};
const POLL_MS = 10000;
const MANUAL = ['observacao', 'diagnostico', 'servico', 'correcao'];

export async function render(el, [id], ctx) {
  let [wo, tickets] = await Promise.all([api.get(`/work-orders/${id}`), loadTickets()]);
  const myHash = location.hash;

  async function loadTickets() {
    return (await api.get(`/work-orders/${id}/tickets`)).data;
  }

  // Executa uma ação; em conflito de versão (outro usuário alterou), recarrega a comanda.
  async function act(fn, okMsg) {
    try {
      wo = await fn();
      if (!ACTIVE.includes(wo.status)) tickets = await loadTickets(); // concluir/cancelar encerra os chamados
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
      <div class="print-only print-header">
        <div class="print-brand">${ctx.brand && ctx.brand.hasLogo ? raw(html`<img class="print-logo" src="/marca/logo?v=${ctx.brand.version}" alt="">`) : ''}<div><b>${(ctx.brand && ctx.brand.name) || 'MotoControl'}</b><span>Ordem de serviço</span></div></div>
        <div class="right">Emitida em ${fmtDateTime(new Date())}<br>por ${ctx.user.name}${ctx.brand && (ctx.brand.name || ctx.brand.hasLogo) ? raw('<br><small class="print-credit">MotoControl</small>') : ''}</div>
      </div>
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
          ${wo.status === 'concluida' && !wo.sale && ctx.can('sales:close') ? raw('<button class="btn btn-primary" data-close-sale>Fechar venda</button>') : ''}
          <button class="btn btn-ghost" data-print>Imprimir</button>
        </div>
      </div>

      ${wo.status === 'cancelada' ? raw(html`<p class="alert alert-danger"><b>Justificativa do cancelamento:</b> ${wo.cancel_reason}</p>`) : ''}
      ${wo.sale ? raw(html`<p class="alert alert-ok no-print"><b>Venda #${wo.sale.id} fechada</b> em ${fmtDateTime(wo.sale.closed_at)} por ${wo.sale.closed_by_name} — total ${fmtMoney(wo.sale.total)}.
        ${ctx.can('sales:read') ? raw('<button type="button" class="link" data-open-sale>Ver detalhes</button>') : ''}</p>`) : ''}
      ${wo.status === 'concluida' && !wo.sale && ctx.can('sales:close') ? raw('<p class="alert no-print">Comanda concluída e <b>ainda sem venda</b>. Confira os valores e feche a venda.</p>') : ''}
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
          <thead><tr><th>Tipo</th><th>Descrição</th><th>Qtd.</th><th class="num">Preço unit.</th><th>Situação</th><th></th></tr></thead>
          <tbody>${wo.items.map((i) => raw(html`<tr>
            <td>${i.kind === 'peca' ? 'Peça' : 'Serviço'}</td>
            <td>${i.description}<br><small class="muted">por ${i.created_by_name}</small></td>
            <td>${i.quantity}</td>
            <td class="num">${i.unit_price === null ? '—' : fmtMoney(i.unit_price)}</td>
            <td>${i.status === 'realizado'
    ? raw(html`<span class="badge status-concluida">${i.kind === 'peca' ? 'Aplicada' : 'Realizado'}</span><br><small class="muted">${i.performed_by_name} · ${fmtDateTime(i.performed_at)}</small>`)
    : raw(html`<span class="badge">${i.kind === 'peca' ? 'Solicitada' : 'Solicitado'}</span>`)}</td>
            <td class="right nowrap">${open && ctx.can('work_orders:items') ? raw(html`
              ${i.status !== 'realizado' ? raw(html`<button class="btn btn-sm btn-ghost" data-item-done="${i.id}">✓ ${i.kind === 'peca' ? 'Aplicada' : 'Realizado'}</button>`) : ''}
              <button class="btn btn-sm btn-ghost danger" data-item-remove="${i.id}" aria-label="Remover">Remover</button>`) : ''}</td>
          </tr>`))}</tbody></table>`) : raw('<p class="empty">Nenhum serviço ou peça registrado.</p>')}
      </section>

      <div class="print-only signatures">
        <p>Data de entrega: ____/____/________</p>
        <div class="signature-lines">
          <div><span></span>Cliente — ${wo.customer_name}</div>
          <div><span></span>Responsável pela oficina</div>
        </div>
      </div>

      <section class="card no-print tickets-card" data-tickets></section>

      <section class="card history-card">
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

  // --- Chamados (D18): conversa da oficina com o balcão, sempre ligada a esta comanda. ---------------
  const sig = (list) => list.map((t) => `${t.id}:${t.status}:${t.messages.length}`).join('|');

  function ticketHtml(t, open) {
    const canWrite = open && t.status === 'aberto' && ctx.can('tickets:use');
    return html`<article class="ticket ticket-${t.status}" data-ticket="${t.id}">
      <header class="ticket-head">
        <b>Chamado #${t.id}</b>
        <span class="tag">para ${t.target_label}</span>
        <span class="badge ${t.status === 'aberto' ? 'status-aberta' : ''}">${t.status === 'aberto' ? 'Aberto' : 'Encerrado'}</span>
        <span class="muted small">aberto por ${t.opened_by_name} (${t.opened_by_role}) em ${fmtDateTime(t.created_at)}</span>
      </header>
      <ol class="chat">${t.messages.map((m) => raw(html`<li class="${m.user_id === ctx.user.id ? 'mine' : ''}">
        <div class="chat-meta"><b>${m.user_name}</b> <span class="muted">(${m.user_role})</span> <time>${fmtDateTime(m.created_at)}</time></div>
        <div class="chat-text pre">${m.body}</div>
      </li>`))}</ol>
      ${t.status === 'encerrado' ? raw(html`<p class="ticket-summary"><b>${t.auto_closed ? 'Encerrado automaticamente' : `Encerrado por ${t.closed_by_name}`}</b>
        em ${fmtDateTime(t.closed_at)}${t.summary ? raw(html` — ${t.summary}`) : ''}</p>`) : ''}
      ${canWrite ? raw(html`<form class="chat-form" data-reply="${t.id}">
        <textarea name="body" rows="2" maxlength="2000" placeholder="Escreva uma resposta…" required></textarea>
        <div class="chat-actions">
          <button class="btn btn-primary btn-sm" type="submit">Enviar</button>
          <button class="btn btn-ghost btn-sm" type="button" data-close-ticket="${t.id}">Encerrar chamado</button>
        </div>
      </form>`) : ''}
    </article>`;
  }

  function drawTickets() {
    const box = el.querySelector('[data-tickets]');
    if (!box) return;
    const open = ACTIVE.includes(wo.status);
    // Preserva o que estiver sendo digitado quando o polling redesenha a seção.
    const drafts = {};
    box.querySelectorAll('[data-reply], [data-new-ticket]').forEach((f) => { drafts[f.dataset.reply || 'new'] = f.body.value; });
    const focused = document.activeElement && box.contains(document.activeElement)
      ? (document.activeElement.form && (document.activeElement.form.dataset.reply || 'new')) : null;
    const canOpen = open && ctx.can('tickets:use');
    const target = ctx.user.role === 'mecanico' ? 'o balcão (atendentes e administrador)' : 'a oficina (mecânicos)';
    box.innerHTML = html`
      <div class="card-head"><h2>Chamados</h2>
        ${canOpen ? raw('<button class="btn btn-ghost btn-sm" data-open-ticket>+ Abrir chamado</button>') : ''}</div>
      <form class="chat-form new-ticket" data-new-ticket hidden>
        <p class="muted small">A mensagem vai para ${target}. Quem responder aparece com nome e horário.</p>
        <textarea name="body" rows="3" maxlength="2000" placeholder="Qual é a dúvida?" required></textarea>
        <div class="chat-actions">
          <button class="btn btn-primary btn-sm" type="submit">Abrir chamado</button>
          <button class="btn btn-ghost btn-sm" type="button" data-cancel-new>Cancelar</button>
        </div>
      </form>
      ${tickets.length ? raw(tickets.slice().reverse().map((t) => ticketHtml(t, open)).join(''))
    : raw('<p class="empty">Nenhum chamado nesta comanda.</p>')}`;
    box.querySelectorAll('[data-reply], [data-new-ticket]').forEach((f) => {
      const k = f.dataset.reply || 'new';
      if (drafts[k]) { f.body.value = drafts[k]; if (k === 'new') f.hidden = false; }
      if (focused === k) { f.hidden = false; f.body.focus(); }
    });
    bindTickets(box);
    markRead();
  }

  // Marca como lidas as mensagens dos chamados abertos que têm algo novo para este usuário.
  function markRead() {
    if (!ctx.can('tickets:use')) return;
    tickets.filter((t) => t.status === 'aberto' && t.unread > 0).forEach((t) => {
      t.unread = 0;
      api.post(`/tickets/${t.id}/read`).then(() => window.dispatchEvent(new Event('tickets:changed'))).catch(() => {});
    });
  }

  async function reloadTickets({ withOrder = false } = {}) {
    if (withOrder) {
      [wo, tickets] = await Promise.all([api.get(`/work-orders/${id}`), loadTickets()]);
      draw();
    } else {
      tickets = await loadTickets();
      drawTickets();
    }
  }

  function bindTickets(box) {
    const guard = (fn) => async (...a) => { try { await fn(...a); } catch (err) { showError(err); await reloadTickets({ withOrder: true }).catch(() => {}); } };
    const newForm = box.querySelector('[data-new-ticket]');
    const openBtn = box.querySelector('[data-open-ticket]');
    if (openBtn) openBtn.addEventListener('click', () => { newForm.hidden = false; newForm.body.focus(); });
    box.querySelector('[data-cancel-new]').addEventListener('click', () => { newForm.body.value = ''; newForm.hidden = true; });
    newForm.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = newForm.body.value.trim();
      if (!body) return;
      newForm.querySelector('[type=submit]').disabled = true;
      await api.post(`/work-orders/${id}/tickets`, { body });
      newForm.body.value = '';
      toast('Chamado aberto.');
      await reloadTickets();
    }));
    box.querySelectorAll('[data-reply]').forEach((f) => f.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = f.body.value.trim();
      if (!body) return;
      f.querySelector('[type=submit]').disabled = true;
      await api.post(`/tickets/${f.dataset.reply}/messages`, { body });
      f.body.value = '';
      await reloadTickets();
    })));
    box.querySelectorAll('[data-reply] textarea').forEach((t) => t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) t.form.requestSubmit();
    }));
    box.querySelectorAll('[data-close-ticket]').forEach((b) => b.addEventListener('click', () => modal({
      title: `Encerrar chamado #${b.dataset.closeTicket}`,
      body: html`<p class="muted small">O resumo vai para o histórico da comanda. A conversa completa continua guardada aqui.</p>
        ${raw(field('Resumo do que foi decidido', '<textarea name="summary" rows="3" maxlength="1000" required></textarea>', { required: true }))}`,
      submitLabel: 'Encerrar',
      onSubmit: async (d) => {
        await api.post(`/tickets/${b.dataset.closeTicket}/close`, d);
        toast('Chamado encerrado.');
        await reloadTickets({ withOrder: true });
        return true;
      },
    })));
  }

  // Polling enquanto esta tela estiver aberta; para sozinho ao sair dela.
  const timer = setInterval(async () => {
    if (!el.isConnected || location.hash !== myHash) { clearInterval(timer); return; }
    if (document.hidden) return;
    try {
      const fresh = await loadTickets();
      if (!el.isConnected || location.hash !== myHash) return;
      const statusChanged = fresh.some((t) => { const old = tickets.find((x) => x.id === t.id); return old && old.status !== t.status; });
      const changed = sig(fresh) !== sig(tickets);
      tickets = fresh;
      if (statusChanged) {
        // Encerrado por outra pessoa: o resumo entrou na linha do tempo; recarrega a comanda se não houver texto pendente.
        const pending = el.querySelector('[data-update-form] textarea');
        if (!pending || !pending.value.trim()) { wo = await api.get(`/work-orders/${id}`); draw(); return; }
      }
      if (changed) drawTickets(); else markRead();
    } catch { /* falha de rede momentânea: tenta de novo no próximo ciclo */ }
  }, POLL_MS);

  function bind() {
    drawTickets();
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
          ${raw(field('Preço unitário (R$)', '<input name="unitPrice" inputmode="decimal" placeholder="0,00">', { hint: 'Opcional: pode ser informado ou corrigido no fechamento da venda.' }))}
        </div>${raw(field('Descrição', '<input name="description" required maxlength="255">', { required: true }))}`,
      submitLabel: 'Adicionar',
      onSubmit: (d) => act(() => api.post(`/work-orders/${id}/items`, d), 'Item adicionado.'),
    }));

    on('[data-close-sale]', 'click', guard(async () => {
      await openClosing(id, ctx, async () => { wo = await api.get(`/work-orders/${id}`); draw(); });
    }));

    on('[data-open-sale]', 'click', guard(async () => {
      await openSale(wo.sale.id, ctx, async () => { wo = await api.get(`/work-orders/${id}`); draw(); });
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
