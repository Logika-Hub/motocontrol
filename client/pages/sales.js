import { api, qs } from '../scripts/api.js';
import { html, raw, pager, fmtMoney, fmtDateTime, fmtPlate, showError, formData } from '../scripts/ui.js';
import { openClosing } from '../scripts/closing.js';
import { openSale } from '../scripts/saleDetail.js';

export async function render(el, _p, ctx) {
  const canClose = ctx.can('sales:close');
  const collabs = ctx.can('finance:admin') ? (await api.get('/finance/collaborators')).data : [];
  let page = 1;
  el.innerHTML = html`
    <div class="page-head"><h1>Vendas</h1></div>
    ${canClose ? raw('<section class="card" data-awaiting></section>') : ''}
    <form class="card filters" data-filters>
      <div class="grid-filters">
        <input name="q" placeholder="Comanda, placa ou cliente">
        <label class="inline">De <input type="date" name="from"></label>
        <label class="inline">até <input type="date" name="to"></label>
        <select name="status"><option value="">Todas as situações</option><option value="concluida">Concluídas</option><option value="estornada">Estornadas</option></select>
        <select name="method"><option value="">Todas as formas de pagamento</option><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="credito">Cartão de crédito</option><option value="debito">Cartão de débito</option></select>
        ${collabs.length ? raw(html`<select name="userId"><option value="">Todos os colaboradores</option>${collabs.map((c) => raw(html`<option value="${c.id}">${c.name}</option>`))}</select>`) : ''}
        <div class="filter-actions"><button class="btn btn-primary" type="submit">Filtrar</button><button class="btn btn-ghost" type="reset" data-reset>Limpar</button></div>
      </div>
    </form>
    <section class="card"><div data-summary class="muted small"></div><div data-list><p class="loading">Carregando…</p></div></section>`;
  const form = el.querySelector('[data-filters]');
  const list = el.querySelector('[data-list]');

  async function loadAwaiting() {
    const host = el.querySelector('[data-awaiting]');
    if (!host) return;
    const rows = (await api.get('/sales/awaiting')).data;
    host.hidden = !rows.length;
    host.innerHTML = rows.length ? html`<h2>Aguardando fechamento <span class="count-badge">${rows.length}</span></h2>
      <table class="table"><thead><tr><th>Comanda</th><th>Cliente · moto</th><th>Concluída em</th><th>Itens</th><th class="num">Valor com preço</th><th></th></tr></thead>
      <tbody>${rows.map((w) => raw(html`<tr><td><a href="#/comandas/${w.id}"><b>${w.code}</b></a></td>
        <td>${w.customer_name}<br><small class="muted">${w.brand} ${w.model}</small> <span class="plate">${fmtPlate(w.plate)}</span></td>
        <td class="nowrap">${fmtDateTime(w.closed_at)}</td><td>${w.items}${w.unpriced ? raw(html` <span class="tag tag-warn">${w.unpriced} sem preço</span>`) : ''}</td>
        <td class="num">${fmtMoney(w.priced_total)}</td>
        <td class="right"><button class="btn btn-sm btn-primary" data-close-sale="${w.id}">Fechar venda</button></td></tr>`))}</tbody></table>` : '';
    host.querySelectorAll('[data-close-sale]').forEach((b) => b.addEventListener('click', async () => {
      try { await openClosing(Number(b.dataset.closeSale), ctx, () => Promise.all([loadAwaiting(), loadSales()])); } catch (e) { showError(e); loadAwaiting().catch(() => {}); }
    }));
  }

  async function loadSales() {
    const f = formData(form);
    const d = await api.get(`/sales${qs({ ...f, page, limit: 20 })}`);
    el.querySelector('[data-summary]').textContent = `${d.summary.count} venda(s) concluída(s) · ${fmtMoney(d.summary.total)} · ${d.summary.voided} estornada(s)`;
    list.innerHTML = d.items.length ? html`<table class="table">
      <thead><tr><th>Venda</th><th>Data</th><th>Comanda</th><th>Cliente · moto</th><th>Colaboradores</th><th>Pagamento</th><th class="num">Total</th><th>Situação</th></tr></thead>
      <tbody>${d.items.map((s) => raw(html`<tr data-sale="${s.id}" class="${s.status === 'estornada' ? 'inactive' : ''}" tabindex="0">
        <td><b>#${s.id}</b></td><td class="nowrap">${fmtDateTime(s.closed_at)}<br><small class="muted">${s.closed_by_name}</small></td>
        <td><a href="#/comandas/${s.work_order_id}">${s.code}</a></td>
        <td>${s.customer_name}<br><small class="muted">${s.brand} ${s.model}</small> <span class="plate">${fmtPlate(s.plate)}</span></td>
        <td>${s.collaborators || '—'}</td><td>${s.methods.map((m) => raw(html`<span class="tag">${m.label}</span> `))}</td>
        <td class="num"><b>${fmtMoney(s.total)}</b>${s.discount ? raw(html`<br><small class="muted">desc. ${fmtMoney(s.discount)}</small>`) : ''}</td>
        <td>${s.status === 'estornada' ? raw('<span class="badge status-estornada">Estornada</span>') : raw('<span class="badge status-concluida">Concluída</span>')}</td></tr>`))}</tbody></table>${raw(pager(d.page, d.limit, d.total))}`
      : '<p class="empty">Nenhuma venda encontrada.</p>';
    list.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { page = Number(b.dataset.page); loadSales().catch(showError); }));
    const open = async (tr) => { try { await openSale(Number(tr.dataset.sale), ctx, () => Promise.all([loadAwaiting(), loadSales()])); } catch (e) { showError(e); } };
    list.querySelectorAll('tr[data-sale]').forEach((tr) => {
      tr.addEventListener('click', (e) => { if (!e.target.closest('a')) open(tr); });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(tr); });
    });
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); page = 1; loadSales().catch(showError); });
  form.addEventListener('reset', () => setTimeout(() => { page = 1; loadSales().catch(showError); }, 0));
  await Promise.all([loadAwaiting(), loadSales()]);
}
