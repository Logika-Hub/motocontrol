import { renderReport } from '../scripts/financeReport.js';

export async function render(el, [id]) {
  await renderReport(el, { base: `/finance/team/${id}`, back: { href: '#/financeiro', label: 'Financeiro' } });
}
