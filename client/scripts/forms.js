// Formulários (modais) reutilizados por várias páginas.
import { api } from './api.js';
import { html, field, modal, esc, toast } from './ui.js';

export function customerModal(customer = null) {
  const c = customer || {};
  return modal({
    title: customer ? 'Editar cliente' : 'Novo cliente',
    body: [
      field('Nome completo', html`<input name="name" value="${c.name || ''}" required maxlength="150">`, { required: true }),
      '<div class="row">',
      field('Telefone', html`<input name="phone" value="${c.phone || ''}" inputmode="tel" placeholder="(11) 98765-4321" required>`, { required: true }),
      field('CPF', html`<input name="cpf" value="${c.cpf || ''}" inputmode="numeric" placeholder="000.000.000-00">`),
      '</div>',
      field('Endereço', html`<input name="address" value="${c.address || ''}">`),
      field('Observações', html`<textarea name="notes" rows="2">${c.notes || ''}</textarea>`),
    ].join(''),
    onSubmit: async (d) => {
      const saved = customer ? await api.put(`/customers/${customer.id}`, d) : await api.post('/customers', d);
      toast(customer ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      return saved;
    },
  });
}

/** Modal de motocicleta. Se `fixedCustomer` for informado, o proprietário já vem selecionado. */
export function motorcycleModal(moto = null, fixedCustomer = null) {
  const m = moto || {};
  const owner = fixedCustomer || (moto ? { id: moto.customer_id, name: moto.customer_name } : null);
  const year = new Date().getFullYear();
  return modal({
    title: moto ? 'Editar motocicleta' : 'Nova motocicleta',
    body: [
      field('Proprietário', html`
        <div class="picker">
          <input type="search" data-owner-search placeholder="Pesquisar cliente por nome, telefone ou CPF" value="${owner ? owner.name : ''}" autocomplete="off">
          <input type="hidden" name="customerId" value="${owner ? owner.id : ''}">
          <ul class="picker-list" hidden></ul>
        </div>`, { required: true }),
      '<div class="row">',
      field('Placa', html`<input name="plate" value="${m.plate || ''}" maxlength="8" class="upper" placeholder="ABC1D23" required>`, { required: true }),
      field('Ano', html`<input name="year" type="number" min="1900" max="${year + 1}" value="${m.year || ''}" required>`, { required: true }),
      '</div><div class="row">',
      field('Marca', html`<input name="brand" value="${m.brand || ''}" list="brands" required>`, { required: true }),
      field('Modelo', html`<input name="model" value="${m.model || ''}" required>`, { required: true }),
      '</div><div class="row">',
      field('Cor', html`<input name="color" value="${m.color || ''}">`),
      field('Quilometragem atual', html`<input name="currentKm" type="number" min="0" value="${m.current_km ?? ''}">`),
      '</div>',
      field('Observações', html`<textarea name="notes" rows="2">${m.notes || ''}</textarea>`),
      '<datalist id="brands"><option>Honda<option>Yamaha<option>Suzuki<option>Kawasaki<option>BMW<option>Triumph<option>Harley-Davidson<option>Royal Enfield<option>Shineray<option>Dafra<option>Haojue</datalist>',
    ].join(''),
    onOpen: (form) => customerPicker(form.querySelector('.picker'), owner),
    onSubmit: async (d) => {
      if (!d.customerId) throw new Error('Selecione o proprietário na lista.');
      const saved = moto ? await api.put(`/motorcycles/${moto.id}`, d) : await api.post('/motorcycles', d);
      toast(moto ? 'Motocicleta atualizada.' : 'Motocicleta cadastrada.');
      return saved;
    },
  });
}

/** Campo de busca com lista de sugestões de clientes. onPick é chamado com o cliente escolhido. */
export function customerPicker(container, initial, onPick = () => {}) {
  const input = container.querySelector('[data-owner-search]');
  const hidden = container.querySelector('input[type=hidden]');
  const list = container.querySelector('.picker-list');
  let timer;
  input.addEventListener('input', () => {
    hidden.value = '';
    onPick(null);
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const { items } = await api.get(`/customers?limit=8&q=${encodeURIComponent(q)}`);
      list.innerHTML = items.length
        ? items.map((c) => `<li data-id="${c.id}" data-name="${esc(c.name)}"><b>${esc(c.name)}</b> <small>${esc(c.phone)}</small></li>`).join('')
        : '<li class="muted">Nenhum cliente encontrado</li>';
      list.hidden = false;
    }, 250);
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    hidden.value = li.dataset.id;
    input.value = li.dataset.name;
    list.hidden = true;
    onPick({ id: Number(li.dataset.id), name: li.dataset.name });
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
  if (initial) onPick(initial);
}
