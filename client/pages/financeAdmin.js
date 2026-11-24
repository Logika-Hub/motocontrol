import { api, qs } from '../scripts/api.js';
import { html, raw, fmtMoney, fmtInt, fmtBucket, showError } from '../scripts/ui.js';
import { barChart, hbar, donut } from '../scripts/charts.js';
import { periodControl, state as period } from '../scripts/period.js';
import { financeTabs } from '../scripts/financeTabs.js';

const METHODS = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito' };
const RANKS = [
  ['sold', 'Faturamento', fmtMoney],
  ['services', 'Serviços realizados', fmtInt],
  ['sales', 'Vendas', fmtInt],
  ['average_ticket', 'Ticket médio', fmtMoney],
  ['overall', 'Melhor desempenho', (v) => `posição média ${v.toLocaleString('pt-BR')}`],
];
const COLS = [
  ['name', 'Colaborador'], ['sales', 'Vendas'], ['services', 'Serviços'], ['sold', 'Faturamento'], ['average_ticket', 'Ticket médio'],
  ['commission_earned', 'Comissão gerada'], ['paid', 'Pago no período'], ['pending_total', 'A receber (saldo)'],
];

export async function render(el, _p, ctx) {
  el.innerHTML = html`
    <div class="page-head"><h1>Financeiro</h1><div data-period></div></div>
    ${raw(financeTabs(ctx))}
    <div data-body><p class="loading">Carregando…</p></div>`;
  const body = el.querySelector('[data-body]');
  let rank = 'sold';
  let sort = { key: 'sold', dir: -1 };
  let data;

  function draw() {
    const d = data;
    const s = d.summary;
    const g = d.period.group;
    const labels = d.evolution.map((e) => fmtBucket(e.bucket, g));
    const first = (list) => (list[0] ? list[0] : null);
    const leader = (title, entry, fmt) => html`<div class="leader"><span class="muted small">${title}</span>
      ${entry ? raw(html`<a href="#/financeiro/colaborador/${entry.user_id}"><b>${entry.name}</b></a><span>${fmt(entry.value)}</span>`) : raw('<b class="muted">—</b><span class="muted small">sem serviços no período</span>')}</div>`;
    const rows = d.team.slice().sort((a, b) => {
      const x = a[sort.key]; const y = b[sort.key];
      return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * sort.dir;
    });
    const named = d.team.filter((t) => t.sold > 0 || t.commission_earned > 0);
    const rk = RANKS.find((r) => r[0] === rank);
    const list = d.ranking[rank];
    body.innerHTML = html`
      <section class="stats stats-4">
        <div class="stat money"><strong>${fmtMoney(s.revenue)}</strong><span>Faturamento</span><small>vendas concluídas no período</small></div>
        <div class="stat"><strong>${fmtInt(s.sales)}</strong><span>Vendas concluídas</span><small>${fmtMoney(s.discounts)} em descontos</small></div>
        <div class="stat"><strong>${fmtInt(s.services)}</strong><span>Serviços realizados</span><small>${fmtMoney(s.services_amount)} em serviços · ${fmtMoney(s.parts_amount)} em peças</small></div>
        <div class="stat money"><strong>${fmtMoney(s.average_ticket)}</strong><span>Ticket médio</span><small>por venda</small></div>
        <div class="stat money owed"><strong>${fmtMoney(s.pending_commissions)}</strong><span>Valores pendentes</span><small>comissões a pagar aos colaboradores${s.overpaid ? ` · ${fmtMoney(s.overpaid)} pagos a mais (a compensar)` : ''}</small></div>
        <div class="stat money pos"><strong>${fmtMoney(s.commission_paid)}</strong><span>Pago aos colaboradores</span><small>${fmtMoney(s.commission_earned)} gerados no período</small></div>
        <a class="stat" href="#/vendas"><strong>${fmtInt(s.awaiting_closing)}</strong><span>Aguardando fechamento</span><small>comandas concluídas sem venda · ${fmtMoney(s.awaiting_closing_amount)} com preço informado</small></a>
        <div class="stat ${s.voided_count ? 'warn' : ''}"><strong>${fmtInt(s.voided_count)}</strong><span>Vendas estornadas</span><small>${fmtMoney(s.voided_amount)} no período</small></div>
      </section>

      <div class="grid-2">
        <section class="card"><h2>Evolução do faturamento</h2>${raw(barChart({ labels, series: [{ name: 'Faturamento', values: d.evolution.map((e) => e.revenue), cls: 'c1' }], label: 'Faturamento por período' }))}</section>
        <section class="card"><h2>Formas de pagamento</h2>${raw(donut({ items: d.by_method.map((m) => ({ label: METHODS[m.method] || m.method, value: m.amount })), label: 'Recebimentos por forma de pagamento' }))}</section>
      </div>

      <h2 class="section-title">Ranking de colaboradores</h2>
      <section class="leaders">
        ${raw(leader('Quem vendeu mais (nº de vendas)', first(d.ranking.sales), (v) => `${fmtInt(v)} venda(s)`))}
        ${raw(leader('Mais serviços realizados', first(d.ranking.services), (v) => `${fmtInt(v)} serviço(s)`))}
        ${raw(leader('Maior faturamento', first(d.ranking.sold), fmtMoney))}
        ${raw(leader('Melhor desempenho', first(d.ranking.overall), (v) => `posição média ${v.toLocaleString('pt-BR')}`))}
      </section>
      <div class="grid-2">
        <section class="card">
          <div class="segmented">${RANKS.map(([k, label]) => raw(html`<button type="button" class="btn btn-sm btn-ghost ${k === rank ? 'active' : ''}" data-rank="${k}">${label}</button>`))}</div>
          ${list.length ? raw(html`<ol class="rank-list">${list.map((r, i) => raw(html`<li class="rank-${i + 1}"><span class="rank-pos">${i + 1}º</span>
            <a href="#/financeiro/colaborador/${r.user_id}">${r.name}</a><b>${rk[2](r.value)}</b></li>`))}</ol>`) : raw('<p class="empty">Nenhum serviço fechado no período.</p>')}
          ${rank === 'overall' ? raw('<p class="muted small">Desempenho = média das posições em faturamento, serviços e vendas (quanto menor, melhor).</p>') : ''}
        </section>
        <section class="card"><h2>Comparativo entre colaboradores</h2>${raw(barChart({
    labels: named.map((t) => t.name.split(' ')[0]),
    series: [{ name: 'Faturamento', values: named.map((t) => t.sold), cls: 'c1' }, { name: 'Comissão gerada', values: named.map((t) => t.commission_earned), cls: 'c2' }],
    label: 'Faturamento e comissão por colaborador' }))}</section>
      </div>

      <div class="grid-2">
        <section class="card"><h2>Serviços mais realizados</h2>${raw(hbar({ rows: d.top_by_count.map((x) => ({ label: x.description, value: x.count })), fmt: (v) => `${v}×`, cls: 'c2', label: 'Serviços mais realizados' }))}</section>
        <section class="card"><h2>Serviços que mais faturam</h2>${raw(hbar({ rows: d.top_by_amount.map((x) => ({ label: x.description, value: x.amount })), cls: 'c3', label: 'Serviços por faturamento' }))}</section>
      </div>

      <section class="card"><h2>Resultado individual</h2>
        ${d.team.length ? raw(html`<table class="table">
          <thead><tr>${COLS.map(([k, label]) => raw(html`<th data-sort="${k}" class="${k === 'name' ? '' : 'num'}">${label}${sort.key === k ? (sort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`))}</tr></thead>
          <tbody>${rows.map((t) => raw(html`<tr data-href="#/financeiro/colaborador/${t.user_id}" class="${t.active ? '' : 'inactive'}">
            <td><b>${t.name}</b>${t.active ? '' : ' (inativo)'}<br><small class="muted">${t.role_name}</small></td>
            <td class="num">${fmtInt(t.sales)}</td><td class="num">${fmtInt(t.services)}</td><td class="num">${fmtMoney(t.sold)}</td><td class="num">${fmtMoney(t.average_ticket)}</td>
            <td class="num">${fmtMoney(t.commission_earned)}</td><td class="num">${fmtMoney(t.paid)}</td>
            <td class="num ${t.pending_total < 0 ? 'money-neg' : ''}">${fmtMoney(t.pending_total)}</td></tr>`))}</tbody></table>
          <p class="muted small">Clique em um colaborador para ver o relatório completo. O saldo considera todo o histórico, não só o período.</p>`) : raw('<p class="empty">Nenhum colaborador.</p>')}
      </section>`;
    body.querySelectorAll('[data-rank]').forEach((b) => b.addEventListener('click', () => { rank = b.dataset.rank; draw(); }));
    body.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : (th.dataset.sort === 'name' ? 1 : -1) };
      draw();
    }));
    body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  }

  async function load() {
    data = await api.get(`/finance/overview${qs({ from: period.from, to: period.to })}`);
    draw();
  }
  const safe = () => load().catch((e) => { body.innerHTML = html`<p class="empty">${e.message}</p>`; showError(e); });
  periodControl(el.querySelector('[data-period]'), safe);
  await load();
}
