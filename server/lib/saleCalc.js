// Cálculo do fechamento de venda. Funções puras (sem banco), em CENTAVOS inteiros, para não haver
// erro de ponto flutuante. Usado tanto na prévia quanto no fechamento: o front nunca calcula valores.
const { badRequest } = require('./errors');

const PAYMENT_METHODS = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito' };

/** Converte reais (número ou texto "12,50") em centavos; recusa mais de 2 casas decimais. */
function toCents(v, field = 'valor') {
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw badRequest(`Valor inválido em ${field}.`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) throw badRequest(`Use no máximo 2 casas decimais em ${field}.`);
  if (Math.abs(cents) > 99999999999) throw badRequest(`Valor muito alto em ${field}.`);
  return cents;
}

const fromCents = (c) => c / 100;

/** Desconto rateado entre os itens, proporcional ao valor bruto; as sobras de centavos vão para os maiores itens. */
function distributeDiscount(grossList, discount) {
  const subtotal = grossList.reduce((s, g) => s + g, 0);
  if (discount === 0 || subtotal === 0) return grossList.map(() => 0);
  const parts = grossList.map((g) => Number((BigInt(discount) * BigInt(g)) / BigInt(subtotal)));
  let rest = discount - parts.reduce((s, p) => s + p, 0);
  const order = grossList.map((g, i) => i).filter((i) => grossList[i] > 0).sort((a, b) => grossList[b] - grossList[a] || a - b);
  for (let k = 0; rest > 0; k = (k + 1) % order.length) { parts[order[k]] += 1; rest -= 1; }
  return parts;
}

/** Comissão de um serviço sobre o valor líquido (já com desconto). Fixo vale por serviço lançado e nunca passa do líquido. */
function commissionFor(rule, netCents) {
  if (!rule) return { type: null, value: null, cents: 0 };
  if (rule.type === 'percentual') {
    const hundredths = Math.round(Number(rule.value) * 100); // 12,5% -> 1250
    return { type: 'percentual', value: Number(rule.value), cents: Math.round((netCents * hundredths) / 10000) };
  }
  return { type: 'fixo', value: Number(rule.value), cents: Math.min(Math.round(Number(rule.value) * 100), netCents) };
}

/**
 * items: [{ id, kind, description, quantity, unitPriceCents, userId }]
 * rules: { byUser: Map<userId, {type,value}>, fallback: {type,value}|null }
 * Retorna os totais e, por item, bruto/desconto/líquido e a comissão (apenas serviços com responsável).
 */
function computeSale({ items, discountCents = 0, rules = { byUser: new Map(), fallback: null } }) {
  if (!items.length) throw badRequest('A comanda não possui serviços ou peças para fechar.');
  if (!Number.isInteger(discountCents) || discountCents < 0) throw badRequest('Desconto inválido.');
  const gross = items.map((i) => Math.round(Number(i.quantity) * i.unitPriceCents));
  const subtotal = gross.reduce((s, g) => s + g, 0);
  if (subtotal <= 0) throw badRequest('O valor da venda deve ser maior que zero. Informe o preço dos itens.');
  if (discountCents >= subtotal) throw badRequest('O desconto deve ser menor que o valor total dos itens.');
  const disc = distributeDiscount(gross, discountCents);
  const out = items.map((it, i) => {
    const net = gross[i] - disc[i];
    const isService = it.kind === 'servico';
    const rule = isService && it.userId ? (rules.byUser.get(it.userId) || rules.fallback || null) : null;
    const c = isService && it.userId ? commissionFor(rule, net) : { type: null, value: null, cents: 0 };
    return {
      ...it, grossCents: gross[i], discountCents: disc[i], netCents: net,
      commissionType: c.type, commissionValue: c.value, commissionCents: c.cents,
    };
  });
  return { subtotalCents: subtotal, discountCents, totalCents: subtotal - discountCents, items: out };
}

/** Valida as formas de pagamento: ao menos uma, métodos conhecidos, valores positivos e soma igual ao total. */
function validatePayments(payments, totalCents) {
  if (!Array.isArray(payments) || !payments.length) throw badRequest('Informe ao menos uma forma de pagamento.');
  if (payments.length > 8) throw badRequest('Informe no máximo 8 formas de pagamento.');
  const list = payments.map((p, i) => {
    if (!p || !PAYMENT_METHODS[p.method]) throw badRequest(`Forma de pagamento inválida (linha ${i + 1}).`);
    const cents = toCents(p.amount, `pagamento ${i + 1}`);
    if (cents <= 0) throw badRequest(`O valor do pagamento ${i + 1} deve ser maior que zero.`);
    return { method: p.method, cents };
  });
  const paid = list.reduce((s, p) => s + p.cents, 0);
  if (paid !== totalCents) {
    throw badRequest(`A soma dos pagamentos (R$ ${(paid / 100).toFixed(2)}) deve ser igual ao total da venda (R$ ${(totalCents / 100).toFixed(2)}).`,
      { paid: fromCents(paid), total: fromCents(totalCents) });
  }
  return list;
}

module.exports = { PAYMENT_METHODS, toCents, fromCents, distributeDiscount, commissionFor, computeSale, validatePayments };
