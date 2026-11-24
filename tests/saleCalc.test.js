// Testes unitários do cálculo de fechamento (sem banco de dados).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCents, distributeDiscount, commissionFor, computeSale, validatePayments } = require('../server/lib/saleCalc');

const noRules = { byUser: new Map(), fallback: null };
const item = (id, kind, qty, price, userId = null) => ({ id, kind, description: `i${id}`, quantity: qty, unitPriceCents: toCents(price), userId });

test('toCents aceita vírgula, recusa 3 casas e valores inválidos', () => {
  assert.equal(toCents('12,50'), 1250);
  assert.equal(toCents(19.9), 1990);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.throws(() => toCents(1.005), /2 casas/);
  assert.throws(() => toCents('abc'), /inválido/);
  assert.throws(() => toCents(''), /inválido/);
});

test('desconto é rateado sem perder centavos e nunca passa do bruto do item', () => {
  const gross = [3333, 3333, 3334];
  const parts = distributeDiscount(gross, 100);
  assert.equal(parts.reduce((s, p) => s + p, 0), 100);
  parts.forEach((p, i) => assert.ok(p <= gross[i]));
  assert.deepEqual(distributeDiscount([100, 0, 50], 1), [1, 0, 0]);
  assert.deepEqual(distributeDiscount([500, 500], 0), [0, 0]);
});

test('comissão percentual incide sobre o líquido; fixa vale por serviço e é limitada ao líquido', () => {
  assert.equal(commissionFor({ type: 'percentual', value: 10 }, 10000).cents, 1000);
  assert.equal(commissionFor({ type: 'percentual', value: 12.5 }, 8000).cents, 1000);
  assert.equal(commissionFor({ type: 'fixo', value: 30 }, 10000).cents, 3000);
  assert.equal(commissionFor({ type: 'fixo', value: 30 }, 2000).cents, 2000);
  assert.equal(commissionFor(null, 10000).cents, 0);
});

test('computeSale: totais, desconto proporcional e comissão por colaborador (peças não geram comissão)', () => {
  const rules = { byUser: new Map([[2, { type: 'fixo', value: 20 }]]), fallback: { type: 'percentual', value: 10 } };
  const r = computeSale({
    items: [item(1, 'servico', 1, '100', 1), item(2, 'servico', 1, '100', 2), item(3, 'peca', 2, '50')],
    discountCents: toCents(30), rules,
  });
  assert.equal(r.subtotalCents, 30000);
  assert.equal(r.totalCents, 27000);
  assert.deepEqual(r.items.map((i) => i.netCents), [9000, 9000, 9000]);
  // colaborador 1: regra padrão 10% de 90,00; colaborador 2: regra própria fixa de 20,00; peça: nada
  assert.deepEqual(r.items.map((i) => i.commissionCents), [900, 2000, 0]);
  assert.equal(r.items.reduce((s, i) => s + i.discountCents, 0), 3000);
});

test('computeSale recusa venda sem itens, sem valor ou com desconto igual/maior que o total', () => {
  assert.throws(() => computeSale({ items: [], rules: noRules }), /não possui/);
  assert.throws(() => computeSale({ items: [item(1, 'servico', 1, '0', 1)], rules: noRules }), /maior que zero/);
  assert.throws(() => computeSale({ items: [item(1, 'servico', 1, '50', 1)], discountCents: 5000, rules: noRules }), /desconto/i);
});

test('quantidade fracionada arredonda o bruto em centavos', () => {
  const r = computeSale({ items: [item(1, 'servico', 1.5, '33.33', 1)], rules: noRules });
  assert.equal(r.subtotalCents, 5000); // 1,5 × 33,33 = 49,995 → 50,00
});

test('validatePayments: soma exata, métodos válidos, divisão entre formas', () => {
  const ok = validatePayments([{ method: 'pix', amount: 100 }, { method: 'dinheiro', amount: '50,50' }], 15050);
  assert.deepEqual(ok, [{ method: 'pix', cents: 10000 }, { method: 'dinheiro', cents: 5050 }]);
  assert.throws(() => validatePayments([{ method: 'pix', amount: 100 }], 15050), /soma dos pagamentos/);
  assert.throws(() => validatePayments([{ method: 'cheque', amount: 150.5 }], 15050), /inválida/);
  assert.throws(() => validatePayments([], 100), /ao menos uma/);
  assert.throws(() => validatePayments([{ method: 'pix', amount: 0 }, { method: 'debito', amount: 1 }], 100), /maior que zero/);
});
