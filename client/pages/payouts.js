import { api, qs } from '../scripts/api.js';
import { html, raw, field, modal, toast, showError, pager, fmtMoney, fmtDateTime } from '../scripts/ui.js';
import { financeTabs } from '../scripts/financeTabs.js';

const METHODS = [['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'], ['outro', 'Outro']];
const dec = (n) => Number(n).toFixed(2).replace('.', ',');

export async function render(el, _p, ctx) {
  el.innerHTML = html`
    <div class="page-head"><h1>Financeiro</h1></div>
    ${raw(financeTabs(ctx))}
    <div data-balances></div>
    <section class="card"><div class="card-head"><h2>Histórico de pagamentos</h2>
      <label class="inline">Colaborador <select data-filter><option value="">Todos</option></select></label></div>
      <div data-history></div></section>`;
  const balHost = el.querySelector('[data-balances]');
  const histHost = el.querySelector('[data-history]');
  const filter = el.querySelector('[data-filter]');
  let page = 1;
  let balances = [];

  async function loadBalances() {
    balances = (await api.get('/finance/balances')).data;
    const sel = filter.value;
    filter.innerHTML = '<option value="">Todos</option>' + balances.map((b) => html`<option value="${b.user_id}">${b.name}</option>`).join('');
    filter.value = sel;
    const owed = balances.reduce((s, b) => s + Math.max(b.pending, 0), 0);
    balHost.innerHTML = html`<section class="card"><div class="card-head"><h2>Comissões dos colaboradores</h2>
        <span class="muted">Total a pagar: <b>${fmtMoney(owed)}</b></span></div>
      ${balances.length ? raw(html`<table class="table">
        <thead><tr><th>Colaborador</th><th class="num">Comissão gerada</th><th class="num">Já pago</th><th class="num">A pagar</th><th>Último pagamento</th><th></th></tr></thead>
        <tbody>${balances.map((b) => raw(html`<tr class="${b.active ? '' : 'inactive'}">
          <td><a href="#/financeiro/colaborador/${b.user_id}"><b>${b.name}</b></a>${b.active ? '' : ' (inativo)'}<br><small class="muted">${b.role_name}</small></td>
          <td class="num">${fmtMoney(b.earned)}</td><td class="num">${fmtMoney(b.paid)}</td>
          <td class="num ${b.pending < 0 ? 'money-neg' : ''}"><b>${fmtMoney(b.pending)}</b>${b.pending < 0 ? raw('<br><small>a compensar</small>') : ''}</td>
          <td>${b.last_paid_at ? fmtDateTime(b.last_paid_at) : '—'}</td>
          <td class="right"><button class="btn btn-sm btn-primary" data-pay="${b.user_id}" ${b.pending > 0 ? '' : 'disabled'}>Registrar pagamento</button></td>
        </tr>`))}</tbody></table>
        <p class="muted small">A pagar = comissão das vendas válidas − pagamentos já registrados. Vendas estornadas deixam de gerar comissão.</p>`) : raw('<p class="empty">Nenhum colaborador com comissão ainda. As comissões nascem no fechamento das comandas.</p>')}</section>`;
    balHost.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => pay(balances.find((x) => x.user_id === Number(b.dataset.pay)))));
  }

  function pay(b) {
    modal({
      title: `Registrar pagamento — ${b.name}`,
      body: html`<p>Saldo a pagar: <b>${fmtMoney(b.pending)}</b> <button type="button" class="link" data-all>pagar tudo</button></p>
        <div class="row">
          ${raw(field('Valor (R$)', html`<input name="amount" inputmode="decimal" required value="${dec(b.pending)}">`, { required: true, hint: 'Pode ser parcial.' }))}
          ${raw(field('Forma', `<select name="method">${METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`))}
        </div>${raw(field('Observação', '<textarea name="note" rows="2" placeholder="Opcional (ex.: adiantamento, fechamento da quinzena)"></textarea>'))}`,
      submitLabel: 'Registrar pagamento',
      onOpen: (form) => form.querySelector('[data-all]').addEventListener('click', () => { form.amount.value = dec(b.pending); }),
      onSubmit: async (d) => {
        await api.post('/finance/payouts', { userId: b.user_id, amount: d.amount, method: d.method, note: d.note });
        toast('Pagamento registrado.');
        await Promise.all([loadBalances(), loadHistory()]);
        return true;
      },
    });
  }

  async function loadHistory() {
    const d = await api.get(`/finance/payouts${qs({ userId: filter.value, page, limit: 15 })}`);
    histHost.innerHTML = d.items.length ? html`<table class="table">
      <thead><tr><th>Data</th><th>Colaborador</th><th class="num">Valor</th><th>Forma</th><th>Observação</th><th>Registrado por</th><th>Situação</th><th></th></tr></thead>
      <tbody>${d.items.map((p) => raw(html`<tr class="${p.status === 'cancelado' ? 'inactive' : ''}">
        <td class="nowrap">${fmtDateTime(p.paid_at)}</td><td>${p.user_name}</td><td class="num">${fmtMoney(p.amount)}</td><td>${p.method_label}</td><td>${p.note || '—'}</td><td>${p.paid_by_name}</td>
        <td>${p.status === 'cancelado' ? raw(html`<span class="tag tag-danger">Cancelado</span><br><small class="muted">${p.cancelled_by_name}: ${p.cancel_reason}</small>`) : raw('<span class="tag tag-ok">Pago</span>')}</td>
        <td class="right">${p.status === 'ativo' ? raw(html`<button class="btn btn-sm btn-ghost danger" data-cancel="${p.id}">Cancelar</button>`) : ''}</td>
      </tr>`))}</tbody></table>${raw(pager(d.page, d.limit, d.total))}` : '<p class="empty">Nenhum pagamento registrado.</p>';
    histHost.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); loadHistory().catch(showError); }));
    histHost.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => modal({
      title: 'Cancelar pagamento',
      body: html`<p class="muted small">O registro continua no histórico, marcado como cancelado, e o valor volta para o saldo a pagar.</p>
        ${raw(field('Motivo', '<textarea name="reason" rows="2" required></textarea>', { required: true }))}`,
      submitLabel: 'Cancelar pagamento', danger: true,
      onSubmit: async (d) => {
        await api.post(`/finance/payouts/${b.dataset.cancel}/cancel`, d);
        toast('Pagamento cancelado.');
        await Promise.all([loadBalances(), loadHistory()]);
        return true;
      },
    })));
  }

  filter.addEventListener('change', () => { page = 1; loadHistory().catch(showError); });
  await loadBalances();
  await loadHistory();
}
