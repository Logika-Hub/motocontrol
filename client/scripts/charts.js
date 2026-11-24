// Gráficos em SVG puro (sem biblioteca, sem estilo inline — o CSP do sistema não permite).
// Cores e tamanhos vêm de classes CSS (.c1…c6, .chart …). Cada elemento tem <title> com o valor exato (acessível ao passar o mouse).
import { esc, fmtMoney } from './ui.js';

const W = 560;
const DONUT = ['c1', 'c2', 'c3', 'c5', 'c6', 'c4']; // cores bem distintas entre si
const EMPTY = '<p class="empty chart-empty">Sem movimento no período.</p>';

function niceMax(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
export function shortMoney(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}
const legend = (series) => (series.length > 1
  ? `<ul class="legend">${series.map((s) => `<li class="${s.cls}"><i class="sw"></i>${esc(s.name)}</li>`).join('')}</ul>` : '');

function frame(labels, series, { height, axis }) {
  const m = { l: 52, r: 8, t: 10, b: 30 };
  const iw = W - m.l - m.r;
  const ih = height - m.t - m.b;
  const top = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const y = (v) => m.t + ih - (v / top) * ih;
  const gw = iw / labels.length;
  const every = Math.ceil(labels.length / 8);
  let g = '';
  for (let i = 0; i <= 4; i += 1) {
    const v = (top / 4) * i;
    g += `<line class="${i ? 'grid' : 'zero'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`
      + `<text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(axis(v))}</text>`;
  }
  labels.forEach((l, i) => {
    if (i % every === 0) g += `<text class="ax" x="${m.l + gw * (i + 0.5)}" y="${height - 10}" text-anchor="middle">${esc(l)}</text>`;
  });
  return { m, ih, gw, y, grid: g };
}

/** Barras agrupadas. series: [{ name, values, cls }]. */
export function barChart({ labels, series, fmt = fmtMoney, axis = shortMoney, height = 230, label = 'Gráfico de barras' }) {
  if (!labels.length || !series.some((s) => s.values.some((v) => v > 0))) return EMPTY;
  const f = frame(labels, series, { height, axis });
  const pad = Math.min(8, f.gw * 0.18);
  const bw = Math.max((f.gw - pad * 2) / series.length, 1);
  let bars = '';
  labels.forEach((l, i) => series.forEach((s, j) => {
    const v = s.values[i];
    if (!(v > 0)) return;
    const top = f.y(v);
    bars += `<rect class="bar ${s.cls}" x="${(f.m.l + f.gw * i + pad + bw * j).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(bw - 1, 1).toFixed(1)}" height="${Math.max(f.m.t + f.ih - top, 1).toFixed(1)}" rx="2"><title>${esc(l)} — ${esc(s.name)}: ${esc(fmt(v))}</title></rect>`;
  }));
  return `<figure class="chart">${legend(series)}<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">${f.grid}${bars}</svg></figure>`;
}

/** Linhas (evolução no tempo). series: [{ name, values, cls }]. */
export function lineChart({ labels, series, fmt = fmtMoney, axis = shortMoney, height = 230, label = 'Gráfico de linhas' }) {
  if (!labels.length || !series.some((s) => s.values.some((v) => v > 0))) return EMPTY;
  const f = frame(labels, series, { height, axis });
  const dots = labels.length <= 40;
  const body = series.map((s) => {
    const pts = s.values.map((v, i) => `${(f.m.l + f.gw * (i + 0.5)).toFixed(1)},${f.y(v).toFixed(1)}`);
    const circles = dots ? s.values.map((v, i) => `<circle class="dot ${s.cls}" cx="${(f.m.l + f.gw * (i + 0.5)).toFixed(1)}" cy="${f.y(v).toFixed(1)}" r="3.5"><title>${esc(labels[i])} — ${esc(s.name)}: ${esc(fmt(v))}</title></circle>`).join('') : '';
    return `<polyline class="line ${s.cls}" points="${pts.join(' ')}"/>${circles}`;
  }).join('');
  return `<figure class="chart">${legend(series)}<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">${f.grid}${body}</svg></figure>`;
}

/** Barras horizontais (rankings e mais realizados). rows: [{ label, value }]. */
export function hbar({ rows, fmt = fmtMoney, cls = 'c1', label = 'Gráfico de barras horizontais' }) {
  if (!rows.length || !rows.some((r) => r.value > 0)) return EMPTY;
  const rowH = 28;
  const lw = 170;
  const vw = 86;
  const max = Math.max(...rows.map((r) => r.value));
  const bw = W - lw - vw - 6;
  const cut = (t) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);
  const body = rows.map((r, i) => {
    const w = r.value > 0 ? Math.max((r.value / max) * bw, 3) : 0;
    const y = i * rowH + 4;
    return `<text class="ax lbl" x="0" y="${y + 14}"><title>${esc(r.label)}</title>${esc(cut(r.label))}</text>`
      + `<rect class="bar ${cls}" x="${lw}" y="${y}" width="${w.toFixed(1)}" height="18" rx="3"><title>${esc(r.label)}: ${esc(fmt(r.value))}</title></rect>`
      + `<text class="val" x="${(lw + w + 6).toFixed(1)}" y="${y + 14}">${esc(fmt(r.value))}</text>`;
  }).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${rows.length * rowH + 8}" role="img" aria-label="${esc(label)}">${body}</svg></figure>`;
}

/** Rosca com legenda. items: [{ label, value }]. */
export function donut({ items, fmt = fmtMoney, label = 'Distribuição' }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total <= 0) return EMPTY;
  const r = 62;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const segs = items.map((it, i) => {
    const len = (it.value / total) * C;
    const s = `<circle class="seg ${DONUT[i % 6]}" cx="90" cy="90" r="${r}" stroke-width="28" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 90 90)"><title>${esc(it.label)}: ${esc(fmt(it.value))}</title></circle>`;
    acc += len;
    return s;
  }).join('');
  const list = items.map((it, i) => `<li class="${DONUT[i % 6]}"><span><i class="sw"></i>${esc(it.label)}</span><b>${esc(fmt(it.value))}</b><small class="muted">${Math.round((it.value / total) * 100)}%</small></li>`).join('');
  return `<figure class="chart donut-wrap"><svg viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">${segs}<text class="val ctr" x="90" y="86" text-anchor="middle">Total</text><text class="val ctr b" x="90" y="104" text-anchor="middle">${esc(fmt(total))}</text></svg><ul class="donut-legend">${list}</ul></figure>`;
}
