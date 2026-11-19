const { badRequest } = require('./errors');

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const optStr = (v) => {
  const s = str(v);
  return s === '' ? null : s;
};
const digits = (v) => str(v).replace(/\D/g, '');

function required(fields) {
  const missing = Object.entries(fields).filter(([, v]) => v === null || v === undefined || v === '').map(([k]) => k);
  if (missing.length) throw badRequest(`Campos obrigatórios não informados: ${missing.join(', ')}.`, { missing });
}

function optInt(v, field, { min = 0, max = 2147483647 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`Valor inválido para ${field}.`);
  return n;
}

function normalizePlate(v) {
  const plate = str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Padrão antigo (ABC1234) e Mercosul (ABC1D23)
  if (plate && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) throw badRequest('Placa inválida.');
  return plate;
}

function validCpf(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

function normalizeCpf(v) {
  const cpf = digits(v);
  if (!cpf) return null;
  if (!validCpf(cpf)) throw badRequest('CPF inválido.');
  return cpf;
}

function optDate(v, field) {
  const s = optStr(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw badRequest(`Data inválida para ${field}.`);
  return s;
}

function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Identificador inválido.');
  return n;
}

function pagination(q) {
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
  const page = Math.max(Number(q.page) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

module.exports = { str, optStr, digits, required, optInt, normalizePlate, normalizeCpf, optDate, idParam, pagination };
