// Painel de fechamento da comanda: confere itens, preços, responsáveis, desconto e formas de pagamento.
// Nenhum valor é calculado aqui: a cada alteração o servidor recalcula (POST /sales/preview) e a tela só exibe o resultado.
import { api } from './api.js';
import { html, raw, esc, field, modal, toast, fmtMoney } from './ui.js';

export async function openClosing(workOrderId, ctx, onDone) {
  const data = await api.get(`/sales/closing/${workOrderId}`); // recusa (409) se não puder ser fechada
  let done = false; // após fechar, nenhuma prévia pendente pode ser disparada
  const withComm = ctx.can('finance:admin');
  const wo = data.work_order;
  const price = (i) => (i.unit_price === null ? '' : Number(i.unit_price).toFixed(2).replace('.', ','));
  const users = (sel) => data.collaborators.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const methods = (sel) => data.payment_methods.map((m) => `<option value="${m.code}" ${m.code === sel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');

  const body = html`
    <p class="muted small">${wo.code} · ${wo.customer_name} · ${wo.brand} ${wo.model} <span class="plate">${wo.plate}</span></p>
    <div class="table-scroll"><table class="table closing-items">
      <thead><tr><th>Item</th><th>Qtd.</th><th>Preço unit. (R$)</th><th>Responsável</th><th class="num">Valor</th><th class="num">Desconto</th><th class="num">Líquido</th>${withComm ? raw('<th class="num">Comissão</th>') : ''}</tr></thead>
      <tbody>${data.items.map((i) => raw(html`<tr data-item="${i.id}">
        <td><span class="tag">${i.kind === 'peca' ? 'Peça' : 'Serviço'}</span> ${i.description}</td>
        <td>${i.quantity}</td>
        <td><input data-price inputmode="decimal" placeholder="0,00" value="${price(i)}" aria-label="Preço de ${i.description}"></td>
        <td>${i.kind === 'servico' ? raw(`<select data-user aria-label="Responsável">${users(i.performed_by)}</select>`) : '—'}</td>
        <td class="num" data-gross>—</td><td class="num" data-disc>—</td><td class="num" data-net>—</td>${withComm ? raw('<td class="num" data-comm>—</td>') : ''}
      </tr>`))}</tbody></table></div>
    <div class="grid-2 closing-grid">
      <div>
        ${raw(field('Desconto (R$)', '<input data-discount inputmode="decimal" placeholder="0,00">', { hint: 'Rateado entre os itens, proporcional ao valor de cada um.' }))}
        <h3 class="mini-title">Formas de pagamento</h3>
        <div data-payments></div>
        <button type="button" class="btn btn-sm btn-ghost" data-add-pay>+ Dividir em outra forma</button>
        ${raw(field('Observações da venda', '<textarea data-notes rows="2" placeholder="Opcional"></textarea>'))}
      </div>
      <aside class="summary-box">
        <div class="sum-row"><span>Subtotal</span><b data-subtotal>—</b></div>
        <div class="sum-row"><span>Desconto</span><b data-discount-total>—</b></div>
        <div class="sum-row sum-total"><span>Total</span><b data-total>—</b></div>
        <div class="sum-row"><span>Pagamentos informados</span><b data-paid>—</b></div>
        <div class="sum-row"><span>Falta informar</span><b data-remaining>—</b></div>
        <hr>
        <div class="muted small">Por colaborador</div>
        <ul class="plain" data-people><li class="muted">—</li></ul>
        ${withComm ? raw('<div class="sum-row"><span>Comissões desta venda</span><b data-comm-total>—</b></div>') : ''}
      </aside>
    </div>
    <p class="form-error" data-error hidden></p>
    <label class="check"><input type="checkbox" data-confirm> Conferi serviços, valores e formas de pagamento.</label>`;

  return modal({
    title: `Fechar venda — ${wo.code}`,
    body, wide: true, submitLabel: 'Confirmar fechamento',
    onOpen: (form) => {
      const $ = (s) => form.querySelector(s);
      const submit = $('[type=submit]');
      let seq = 0;
      let ready = false;
      const refreshSubmit = () => { submit.disabled = !(ready && $('[data-confirm]').checked); };

      function payRow(method = 'pix', amount = '') {
        const row = document.createElement('div');
        row.className = 'pay-row';
        row.innerHTML = `<select data-method aria-label="Forma de pagamento">${methods(method)}</select>
          <input data-amount inputmode="decimal" placeholder="0,00" value="${esc(amount)}" aria-label="Valor pago">
          <button type="button" class="btn btn-sm btn-ghost" data-rest title="Preencher com o que falta">Restante</button>
          <button type="button" class="icon-btn" data-rm aria-label="Remover forma de pagamento">×</button>`;
        $('[data-payments]').appendChild(row);
        return row;
      }
      payRow();

      const collect = () => ({
        workOrderId,
        items: [...form.querySelectorAll('tr[data-item]')].map((tr) => ({
          itemId: Number(tr.dataset.item), unitPrice: tr.querySelector('[data-price]').value.trim(),
          userId: tr.querySelector('[data-user]') ? Number(tr.querySelector('[data-user]').value) : undefined,
        })),
        discount: $('[data-discount]').value.trim(),
        payments: [...form.querySelectorAll('.pay-row')].map((r) => ({ method: r.querySelector('[data-method]').value, amount: r.querySelector('[data-amount]').value.trim() })),
        notes: $('[data-notes]').value.trim(),
      });

      function show(r) {
        const set = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
        for (const i of r.items) {
          const tr = form.querySelector(`tr[data-item="${i.item_id}"]`);
          tr.querySelector('[data-gross]').textContent = fmtMoney(i.gross);
          tr.querySelector('[data-disc]').textContent = i.discount ? `− ${fmtMoney(i.discount)}` : '—';
          tr.querySelector('[data-net]').textContent = fmtMoney(i.net);
          const c = tr.querySelector('[data-comm]');
          if (c) c.textContent = i.kind === 'servico' ? fmtMoney(i.commission) : '—';
        }
        set('[data-subtotal]', fmtMoney(r.subtotal)); set('[data-discount-total]', r.discount ? `− ${fmtMoney(r.discount)}` : '—'); set('[data-total]', fmtMoney(r.total));
        set('[data-paid]', fmtMoney(r.payments ? r.payments.paid : 0)); set('[data-remaining]', fmtMoney(r.payments ? r.payments.remaining : r.total));
        set('[data-comm-total]', fmtMoney(r.commission_total));
        $('[data-people]').innerHTML = r.collaborators.length
          ? r.collaborators.map((p) => `<li>${esc(p.name)} — ${p.services} serviço(s) · ${esc(fmtMoney(p.amount))}${withComm ? ` · comissão ${esc(fmtMoney(p.commission))}` : ''}</li>`).join('')
          : '<li class="muted">Nenhum serviço com responsável.</li>';
      }
      function clear() {
        form.querySelectorAll('[data-gross],[data-disc],[data-net],[data-comm]').forEach((e) => { e.textContent = '—'; });
        ['[data-subtotal]', '[data-discount-total]', '[data-total]', '[data-paid]', '[data-remaining]', '[data-comm-total]'].forEach((s) => { const e = $(s); if (e) e.textContent = '—'; });
      }

      async function preview() {
        if (done) return;
        const my = ++seq;
        ready = false; refreshSubmit();
        try {
          const r = await api.post('/sales/preview', collect());
          if (my !== seq) return;
          show(r);
          const err = $('[data-error]');
          const filled = r.payments && r.payments.paid > 0;
          const balanced = r.payments && Math.abs(r.payments.remaining) < 0.005;
          err.hidden = filled ? balanced : true;
          err.textContent = filled && !balanced ? `A soma dos pagamentos deve ser igual ao total (${r.payments.remaining > 0 ? 'faltam' : 'sobram'} ${fmtMoney(Math.abs(r.payments.remaining))}).` : '';
          ready = !!(filled && balanced);
        } catch (e) {
          if (my !== seq) return;
          clear();
          const err = $('[data-error]');
          err.hidden = false; err.textContent = e.message;
        }
        refreshSubmit();
      }
      let timer;
      const later = () => { clearTimeout(timer); timer = setTimeout(preview, 250); };

      form.addEventListener('input', later);
      form.addEventListener('change', (e) => { if (e.target.matches('[data-confirm]')) refreshSubmit(); else later(); });
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }); // Enter não fecha a venda sem querer
      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-pay]')) { if (form.querySelectorAll('.pay-row').length < 8) payRow('dinheiro').querySelector('[data-amount]').focus(); return; }
        const rm = e.target.closest('[data-rm]');
        if (rm) { if (form.querySelectorAll('.pay-row').length > 1) { rm.closest('.pay-row').remove(); later(); } return; }
        const rest = e.target.closest('[data-rest]');
        if (rest) {
          const row = rest.closest('.pay-row');
          const remaining = $('[data-remaining]').textContent;
          const mine = Number(String(row.querySelector('[data-amount]').value).replace(',', '.')) || 0;
          const num = Number(remaining.replace(/[^\d,-]/g, '').replace(',', '.'));
          if (Number.isFinite(num)) { row.querySelector('[data-amount]').value = (num + mine).toFixed(2).replace('.', ','); later(); }
        }
      });
      refreshSubmit();
      preview();
    },
    onSubmit: async (_d, form) => {
      const get = (s) => form.querySelector(s);
      const payload = {
        workOrderId,
        items: [...form.querySelectorAll('tr[data-item]')].map((tr) => ({
          itemId: Number(tr.dataset.item), unitPrice: tr.querySelector('[data-price]').value.trim(),
          userId: tr.querySelector('[data-user]') ? Number(tr.querySelector('[data-user]').value) : undefined,
        })),
        discount: get('[data-discount]').value.trim(),
        payments: [...form.querySelectorAll('.pay-row')].map((r) => ({ method: r.querySelector('[data-method]').value, amount: r.querySelector('[data-amount]').value.trim() })),
        notes: get('[data-notes]').value.trim(),
      };
      const sale = await api.post('/sales', payload);
      done = true;
      toast(`Venda #${sale.id} fechada: ${fmtMoney(sale.total)}.`);
      if (onDone) await onDone(sale);
      return sale;
    },
  });
}
