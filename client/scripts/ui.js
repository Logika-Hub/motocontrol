// Utilitários de interface: escape de HTML, formatação, toasts, modais e formulários.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Template tag que escapa automaticamente as interpolações (use raw() para HTML confiável). */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i >= values.length) return out + s;
    const v = values[i];
    const rendered = Array.isArray(v) ? v.map((x) => (x && x.__raw ? x.value : esc(x))).join('')
      : v && v.__raw ? v.value : esc(v);
    return out + s + rendered;
  }, '');
}
export const raw = (value) => ({ __raw: true, value: String(value ?? '') });

const dtf = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const tf = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
export const fmtDateTime = (v) => (v ? dtf.format(new Date(v)) : '—');
export const fmtTime = (v) => (v ? tf.format(new Date(v)) : '');
export const fmtDate = (v) => (v ? v.split('-').reverse().join('/') : '—');
export const fmtKm = (v) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR')} km`);
export const fmtPlate = (p) => (p && p.length === 7 && /\d{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p || '');
export function fmtPhone(p) {
  const d = String(p || '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMoney = (v) => (v === null || v === undefined ? '—' : brl.format(Number(v)));
export const fmtInt = (v) => Number(v || 0).toLocaleString('pt-BR');
/** Rótulo de um ponto do gráfico: dia/semana -> dd/mm; mês -> mm/aaaa. */
export function fmtBucket(d, group) {
  const [y, m, day] = String(d).split('-');
  return group === 'month' ? `${m}/${y}` : `${day}/${m}`;
}
export const fmtCpf = (c) => (c ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : '—');

export const STATUS_LABELS = {
  aberta: 'Aberta',
  em_diagnostico: 'Em diagnóstico',
  aguardando_pecas: 'Aguardando peças',
  em_execucao: 'Em execução',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
export const statusBadge = (s) => html`<span class="badge status-${s}">${STATUS_LABELS[s] || s}</span>`;

export function toast(message, type = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3500);
  setTimeout(() => el.remove(), 4000);
}

export function showError(err) {
  toast(err && err.message ? err.message : 'Erro inesperado.', 'error');
}

/** Lê os campos de um formulário como objeto (inputs vazios viram ''). */
export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else data[el.name] = el.value.trim();
  }
  return data;
}

/**
 * Abre um modal com um formulário. onSubmit recebe os dados; se lançar erro, o modal permanece aberto.
 * Retorna uma Promise resolvida com o resultado de onSubmit (ou null se cancelado).
 */
export function modal({ title, body, submitLabel = 'Salvar', danger = false, wide = false, onSubmit, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = html`
      <form class="modal ${wide ? 'modal-lg' : ''}" novalidate>
        <header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">×</button></header>
        <div class="modal-body">${raw(body)}</div>
        <footer>
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>
        </footer>
      </form>`;
    const form = wrap.querySelector('form');
    const close = (result) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(null); });
    document.addEventListener('keydown', onKey);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        close(await onSubmit(formData(form), form));
      } catch (err) {
        showError(err);
        btn.disabled = false;
      }
    });
    document.body.appendChild(wrap);
    const first = form.querySelector('input:not([type=hidden]), textarea, select');
    if (first) first.focus();
    if (onOpen) onOpen(form);
  });
}

export function confirmDialog(title, message, { submitLabel = 'Confirmar', danger = true } = {}) {
  return modal({ title, body: html`<p>${message}</p>`, submitLabel, danger, onSubmit: () => true });
}

export function field(label, input, { hint, required } = {}) {
  return html`<label class="field"><span>${label}${required ? raw(' <b class="req">*</b>') : ''}</span>${raw(input)}${hint ? raw(`<small>${esc(hint)}</small>`) : ''}</label>`;
}

export function pager(page, limit, total) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return html`<p class="muted small">${total} registro(s)</p>`;
  return html`<nav class="pager">
    <button class="btn btn-ghost btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="muted small">Página ${page} de ${pages} · ${total} registro(s)</span>
    <button class="btn btn-ghost btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Próxima ›</button>
  </nav>`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
