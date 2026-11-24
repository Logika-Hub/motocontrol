// Detalhe de uma venda (histórico). Comissões só aparecem para o administrador (o servidor já omite para os demais).
import { api } from './api.js';
import { html, raw, field, modal, toast, fmtMoney, fmtDateTime } from './ui.js';

export async function openSale(id, ctx, onChange) {
  const s = await api.get(`/sales/${id}`);
  const withComm = s.items.some((i) => i.commission_amount !== undefined);
  const voided = s.status === 'estornada';
  const body = html`
    <div class="sale-head">
      <a href="#/comandas/${s.work_order_id}" data-nav>${s.code}</a> · ${s.customer_name} · ${s.brand} ${s.model} <span class="plate">${s.plate}</span>
      <span class="badge ${voided ? 'status-estornada' : 'status-concluida'}">${voided ? 'Estornada' : 'Concluída'}</span>
    </div>
    <p class="muted small">Fechada em ${fmtDateTime(s.closed_at)} por ${s.closed_by_name}</p>
    ${voided ? raw(html`<p class="alert alert-danger"><b>Estornada</b> em ${fmtDateTime(s.voided_at)} por ${s.voided_by_name}. Motivo: ${s.void_reason}</p>`) : ''}
    <div class="table-scroll"><table class="table"><thead><tr><th>Item</th><th>Qtd.</th><th class="num">Preço</th><th class="num">Desconto</th><th class="num">Líquido</th><th>Responsável</th>${withComm ? raw('<th class="num">Comissão</th>') : ''}</tr></thead>
      <tbody>${s.items.map((i) => raw(html`<tr><td><span class="tag">${i.kind === 'peca' ? 'Peça' : 'Serviço'}</span> ${i.description}</td><td>${i.quantity}</td>
        <td class="num">${fmtMoney(i.unit_price)}</td><td class="num">${i.discount_amount ? fmtMoney(i.discount_amount) : '—'}</td><td class="num">${fmtMoney(i.net_amount)}</td>
        <td>${i.user_name || '—'}</td>${withComm ? raw(html`<td class="num">${i.kind === 'servico' ? fmtMoney(i.commission_amount) : '—'}${i.commission_type ? raw(html`<br><small class="muted">${i.commission_type === 'percentual' ? `${i.commission_value}%` : 'fixo'}</small>`) : ''}</td>`) : ''}</tr>`))}</tbody></table></div>
    <div class="grid-2">
      <div><h3 class="mini-title">Pagamento</h3><ul class="plain">${s.payments.map((p) => raw(html`<li>${p.method_label}: <b>${fmtMoney(p.amount)}</b></li>`))}</ul>
        ${s.notes ? raw(html`<p class="notes">${s.notes}</p>`) : ''}</div>
      <div class="summary-box"><div class="sum-row"><span>Subtotal</span><b>${fmtMoney(s.subtotal)}</b></div>
        <div class="sum-row"><span>Desconto</span><b>${s.discount ? `− ${fmtMoney(s.discount)}` : '—'}</b></div>
        <div class="sum-row sum-total"><span>Total</span><b>${fmtMoney(s.total)}</b></div></div>
    </div>
    ${ctx.can('sales:void') && !voided ? raw('<p><button type="button" class="btn btn-ghost danger" data-void>Estornar venda…</button></p>') : ''}`;
  return modal({
    title: `Venda #${s.id}`, body, wide: true, submitLabel: 'Fechar',
    onOpen: (form) => {
      const close = () => form.querySelector('[data-close]').click();
      form.querySelector('[data-nav]').addEventListener('click', () => setTimeout(close, 0));
      const v = form.querySelector('[data-void]');
      if (v) v.addEventListener('click', () => modal({
        title: `Estornar venda #${s.id}`,
        body: html`<p class="muted small">A venda continua no histórico, marcada como estornada, e deixa de contar no faturamento e nas comissões. A comanda poderá ser fechada de novo. Se a comissão já foi paga, o saldo do colaborador fica negativo (a compensar).</p>
          ${raw(field('Motivo do estorno', '<textarea name="reason" rows="2" required></textarea>', { required: true }))}`,
        submitLabel: 'Estornar venda', danger: true,
        onSubmit: async (d) => { await api.post(`/sales/${s.id}/void`, d); toast('Venda estornada.'); return true; },
      }).then((ok) => { if (ok) { close(); if (onChange) onChange(); } }));
    },
    onSubmit: () => true,
  });
}
