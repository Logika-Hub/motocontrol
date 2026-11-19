import { api } from '../scripts/api.js';
import { html, raw, esc, field, formData, fmtPlate, fmtKm, toast, showError } from '../scripts/ui.js';
import { hashQuery } from '../scripts/app.js';
import { customerModal, motorcycleModal } from '../scripts/forms.js';

export async function render(el, _p, ctx) {
  let moto = null;
  const pre = hashQuery().moto;
  if (pre) moto = await api.get(`/motorcycles/${pre}`).catch(() => null);

  el.innerHTML = html`
    <div class="page-head"><div><a class="back" href="#/comandas">‹ Comandas</a><h1>Nova comanda</h1></div></div>
    <section class="card">
      <h2>1. Motocicleta</h2>
      <div class="picker">
        <input type="search" data-moto-search placeholder="Pesquisar por placa, modelo ou proprietário" autocomplete="off">
        <ul class="picker-list" hidden></ul>
      </div>
      <div data-selected></div>
      <p class="muted small">Moto ainda não cadastrada?
        ${ctx.can('customers:write') ? raw('<button type="button" class="link" data-new-customer>Cadastrar cliente</button> ·') : ''}
        ${ctx.can('motorcycles:write') ? raw('<button type="button" class="link" data-new-moto>Cadastrar motocicleta</button>') : ''}</p>
    </section>
    <form class="card form" novalidate data-form>
      <h2>2. Atendimento</h2>
      ${raw(field('Reclamação do cliente', '<textarea name="complaint" rows="3" required placeholder="Descreva o problema relatado pelo cliente"></textarea>', { required: true }))}
      <div class="row">
        ${raw(field('Km na entrada', '<input name="entryKm" type="number" min="0">'))}
        ${raw(field('Previsão de entrega', '<input name="expectedDelivery" type="date">'))}
      </div>
      ${raw(field('Observações', '<textarea name="notes" rows="2" placeholder="Estado do veículo, itens deixados, etc."></textarea>'))}
      <div class="actions"><button class="btn btn-primary" type="submit">Abrir comanda</button></div>
    </form>`;

  const selected = el.querySelector('[data-selected]');
  const search = el.querySelector('[data-moto-search]');
  const list = el.querySelector('.picker-list');
  const form = el.querySelector('[data-form]');

  function select(m) {
    moto = m;
    if (!m) { selected.innerHTML = ''; return; }
    selected.innerHTML = html`<div class="selected-moto">
      <span class="plate plate-lg">${fmtPlate(m.plate)}</span>
      <div><b>${m.brand} ${m.model}</b> ${m.year}<br><span class="muted">${m.customer_name} · ${fmtKm(m.current_km)}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-unselect>Trocar</button></div>`;
    selected.querySelector('[data-unselect]').addEventListener('click', () => { select(null); search.focus(); });
    if (m.current_km !== null && m.current_km !== undefined) form.entryKm.placeholder = `Última: ${m.current_km}`;
    search.value = '';
    form.complaint.focus();
  }

  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const { items } = await api.get(`/motorcycles?limit=8&q=${encodeURIComponent(q)}`);
      list.innerHTML = items.length ? items.map((m, i) => `<li data-i="${i}"><span class="plate">${esc(fmtPlate(m.plate))}</span>
        <b>${esc(m.brand)} ${esc(m.model)}</b> <small>${esc(m.customer_name)}</small></li>`).join('')
        : '<li class="muted">Nenhuma motocicleta encontrada</li>';
      list.items = items;
      list.hidden = false;
    }, 250);
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    list.hidden = true;
    select(list.items[Number(li.dataset.i)]);
  });
  search.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));

  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
  on('[data-new-customer]', async () => {
    const c = await customerModal();
    if (c && ctx.can('motorcycles:write')) {
      const m = await motorcycleModal(null, { id: c.id, name: c.name });
      if (m) select({ ...m, customer_name: c.name });
    }
  });
  on('[data-new-moto]', async () => {
    const m = await motorcycleModal();
    if (m) select(await api.get(`/motorcycles/${m.id}`));
  });

  if (moto) select(moto); else search.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!moto) return showError(new Error('Selecione a motocicleta.'));
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const wo = await api.post('/work-orders', { ...formData(form), motorcycleId: moto.id, customerId: moto.customer_id });
      toast(`Comanda ${wo.code} aberta.`);
      ctx.navigate(`/comandas/${wo.id}`);
    } catch (err) {
      showError(err);
      btn.disabled = false;
    }
  });
}
