import { renderReport } from '../scripts/financeReport.js';

// Painel individual: a rota /finance/me usa sempre o usuário logado — não há como pedir dados de outra pessoa.
export async function render(el) {
  await renderReport(el, { base: '/finance/me', title: 'Meu painel' });
}
