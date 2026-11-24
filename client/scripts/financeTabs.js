import { html, raw } from './ui.js';

const TABS = [
  ['#/financeiro', 'Visão geral', /^\/financeiro$/, 'finance:admin'],
  ['#/financeiro/repasses', 'Repasses', /^\/financeiro\/repasses/, 'finance:admin'],
  ['#/financeiro/comissoes', 'Regras de comissão', /^\/financeiro\/comissoes/, 'commissions:manage'],
];

export function financeTabs(ctx) {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  return html`<nav class="tabs">${TABS.filter((t) => ctx.can(t[3])).map(([href, label, re]) => raw(html`<a href="${href}" class="${re.test(path) ? 'active' : ''}">${label}</a>`))}</nav>`;
}
