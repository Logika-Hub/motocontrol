// Relatório de desempenho e ganhos de UM colaborador. Usado no painel pessoal (/finance/me) e na visão do
// administrador (/finance/team/:id): a tela é a mesma; o que muda é a rota, e é o servidor quem restringe os dados.
import { api, qs } from './api.js';
import { html, raw, pager, fmtMoney, fmtInt, fmtBucket, fmtDateTime, showError } from './ui.js';
import { barChart, lineChart, hbar } from './charts.js';
import { periodControl, state as period } from './period.js';

const METHOD_TAG = { ativo: '', cancelado: 'tag tag-danger' };

export async function renderReport(el, { base, title, back }) {
  el.innerHTML = html`
    <div class="page-head">
      <div>${back ? raw(html`<a class="back" href="${back.href}">‹ ${back.label}</a>`) : ''}<h1 data-title>${title || 'Painel'}</h1><p class="muted small" data-sub></p></div>
      <div data-period></div>
    </div>
    <div data-report><p class="loading">Carregando…</p></div>`;
  const box = el.querySelector('[data-report]');
  let svcPage = 1;
  let payPage = 1;

  async function load() {
    const q = { from: period.from, to: period.to };
    const r = await api.get(`${base}${qs(q)}`);
    el.querySelector('[data-title]').textContent = title || r.user.name;
    el.querySelector('[data-sub]').textContent = `${r.user.role_name}${r.user.active ? '' : ' · inativo'}`;
    const g = r.period.group;
    const labels = r.evolution.map((e) => fmtBucket(e.bucket, g));
    const s = r.summary;
    const t = r.totals;
    const neg = t.pending < 0;
    box.innerHTML = html`
      <section class="stats stats-6">
        <div class="stat money"><strong>${fmtMoney(s.sold)}</strong><span>Total vendido</span><small>valor dos serviços, já com desconto</small></div>
        <div class="stat"><strong>${fmtInt(s.services)}</strong><span>Serviços realizados</span><small>em ${fmtInt(s.sales)} venda(s)</small></div>
        <div class="stat money"><strong>${fmtMoney(s.average_ticket)}</strong><span>Ticket médio</span><small>por venda</small></div>
        <div class="stat money"><strong>${fmtMoney(s.commission_earned)}</strong><span>Comissão gerada</span><small>no período</small></div>
        <div class="stat money pos"><strong>${fmtMoney(s.paid)}</strong><span>Já recebido</span><small>pagamentos no período</small></div>
        <div class="stat money ${neg ? 'warn' : 'owed'}"><strong>${fmtMoney(Math.abs(t.pending))}</strong><span>${neg ? 'Saldo a compensar' : 'A receber'}</span>
          <small>${neg ? 'pago acima do ganho (após estorno) · ' : 'saldo atual · '}ganho total ${fmtMoney(t.earned)} · pago ${fmtMoney(t.paid)}</small></div>
      </section>
      <div class="grid-2">
        <section class="card"><h2>Vendas no período</h2>${raw(barChart({ labels, series: [{ name: 'Vendido', values: r.evolution.map((e) => e.sold), cls: 'c1' }], label: 'Valor vendido por período' }))}</section>
        <section class="card"><h2>Evolução dos ganhos <small class="muted">(acumulado no período)</small></h2>${raw(lineChart({ labels, series: [
    { name: 'Comissão gerada', values: r.evolution.map((e) => e.commission_acc), cls: 'c1' },
    { name: 'Recebido', values: r.evolution.map((e) => e.paid_acc), cls: 'c2' },
  ], label: 'Comissão gerada e valor recebido por período' }))}</section>
      </div>
      <div class="grid-2">
        <section class="card"><h2>Serviços mais realizados</h2>${raw(hbar({ rows: r.top_services.map((x) => ({ label: x.description, value: x.count })), fmt: (v) => `${v}×`, cls: 'c2', label: 'Serviços mais realizados' }))}</section>
        <section class="card"><h2>Serviços que mais renderam</h2>${raw(hbar({ rows: r.top_services.slice().sort((a, b) => b.amount - a.amount).map((x) => ({ label: x.description, value: x.amount })), cls: 'c3', label: 'Serviços por valor vendido' }))}</section>
      </div>
      <section class="card"><h2>Histórico de serviços e vendas</h2><div data-services></div></section>
      <section class="card"><h2>Histórico de recebimentos</h2><div data-payouts></div></section>`;
    await Promise.all([loadServices(), loadPayouts()]);
  }

  async function loadServices() {
    const d = await api.get(`${base}/services${qs({ from: period.from, to: period.to, page: svcPage, limit: 10 })}`);
    const host = box.querySelector('[data-services]');
    host.innerHTML = d.items.length ? html`<table class="table">
      <thead><tr><th>Data</th><th>Comanda</th><th>Cliente · moto</th><th>Serviço</th><th class="num">Valor</th><th class="num">Comissão</th><th>Situação</th></tr></thead>
      <tbody>${d.items.map((i) => raw(html`<tr class="${i.sale_status === 'estornada' ? 'inactive' : ''}">
        <td class="nowrap">${fmtDateTime(i.closed_at)}</td>
        <td><a href="#/comandas/${i.work_order_id}">${i.code}</a></td>
        <td>${i.customer_name}<br><small class="plate">${i.plate}</small></td>
        <td>${i.description}${Number(i.quantity) !== 1 ? ` (×${i.quantity})` : ''}</td>
        <td class="num">${fmtMoney(i.net_amount)}</td>
        <td class="num">${fmtMoney(i.commission_amount)}${i.commission_type ? raw(html`<br><small class="muted">${i.commission_type === 'percentual' ? `${i.commission_value}%` : 'valor fixo'}</small>`) : ''}</td>
        <td>${i.sale_status === 'estornada' ? raw('<span class="tag tag-danger">Venda estornada</span>') : raw('<span class="tag tag-ok">Válida</span>')}</td>
      </tr>`))}</tbody></table>${raw(pager(d.page, d.limit, d.total))}`
      : '<p class="empty">Nenhum serviço fechado no período.</p>';
    host.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { svcPage = Number(b.dataset.page); loadServices().catch(showError); }));
  }

  async function loadPayouts() {
    const d = await api.get(`${base}/payouts${qs({ from: period.from, to: period.to, page: payPage, limit: 10 })}`);
    const host = box.querySelector('[data-payouts]');
    host.innerHTML = d.items.length ? html`<table class="table">
      <thead><tr><th>Data</th><th class="num">Valor</th><th>Forma</th><th>Observação</th><th>Registrado por</th><th>Situação</th></tr></thead>
      <tbody>${d.items.map((p) => raw(html`<tr class="${p.status === 'cancelado' ? 'inactive' : ''}">
        <td class="nowrap">${fmtDateTime(p.paid_at)}</td><td class="num">${fmtMoney(p.amount)}</td><td>${p.method_label}</td><td>${p.note || '—'}</td><td>${p.paid_by_name}</td>
        <td>${p.status === 'cancelado' ? raw(html`<span class="${METHOD_TAG.cancelado}">Cancelado</span><br><small class="muted">${p.cancel_reason}</small>`) : raw('<span class="tag tag-ok">Pago</span>')}</td>
      </tr>`))}</tbody></table>${raw(pager(d.page, d.limit, d.total))}`
      : '<p class="empty">Nenhum pagamento recebido no período.</p>';
    host.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { payPage = Number(b.dataset.page); loadPayouts().catch(showError); }));
  }

  const safe = () => load().catch((e) => { box.innerHTML = html`<p class="empty">${e.message}</p>`; });
  periodControl(el.querySelector('[data-period]'), () => { svcPage = 1; payPage = 1; safe(); });
  await load();
}
