// Filtro de período dos painéis: dia, semana, mês ou intervalo personalizado.
// O estado fica no módulo, então o filtro escolhido acompanha o usuário entre as telas financeiras.
import { html, raw } from './ui.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function presetRange(preset) {
  const t = new Date();
  if (preset === 'dia') return { from: iso(t), to: iso(t) };
  if (preset === 'semana') {
    const d = new Date(t);
    d.setDate(t.getDate() - ((t.getDay() + 6) % 7)); // segunda-feira
    return { from: iso(d), to: iso(t) };
  }
  return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
}

export const state = { preset: 'mes', ...presetRange('mes') };

const PRESETS = [['dia', 'Hoje'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['custom', 'Personalizado']];

/** Desenha o seletor em `host` e chama onChange({from,to}) a cada mudança válida. */
export function periodControl(host, onChange) {
  function draw() {
    host.innerHTML = html`<div class="period">
      <div class="segmented">${PRESETS.map(([k, label]) => raw(html`<button type="button" class="btn btn-sm btn-ghost ${state.preset === k ? 'active' : ''}" data-preset="${k}">${label}</button>`))}</div>
      ${state.preset === 'custom' ? raw(html`
        <label class="inline">De <input type="date" data-from value="${state.from}" max="${state.to}"></label>
        <label class="inline">até <input type="date" data-to value="${state.to}" min="${state.from}"></label>
        <button type="button" class="btn btn-sm btn-primary" data-apply>Aplicar</button>`) : raw(html`<span class="muted small">${state.from.split('-').reverse().join('/')} a ${state.to.split('-').reverse().join('/')}</span>`)}
    </div>`;
    host.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.preset;
      state.preset = k;
      if (k !== 'custom') Object.assign(state, presetRange(k));
      draw();
      if (k !== 'custom') onChange({ from: state.from, to: state.to });
    }));
    const apply = host.querySelector('[data-apply]');
    if (apply) apply.addEventListener('click', () => {
      const from = host.querySelector('[data-from]').value;
      const to = host.querySelector('[data-to]').value;
      if (!from || !to || from > to) return;
      Object.assign(state, { from, to });
      draw();
      onChange({ from, to });
    });
  }
  draw();
}
