/*
 * Identidade da oficina: nome e logo exibidos na barra superior, na tela de entrada e na impressão.
 * Só PNG, JPEG e WEBP — o tipo é conferido pelos bytes do arquivo, não pelo que o navegador declara.
 * SVG é recusado de propósito: pode conter script.
 */
const { query } = require('../config/db');
const { badRequest } = require('../lib/errors');

const MAX_LOGO_BYTES = 512 * 1024;
const MAX_NAME = 80;

function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function parseLogo(dataUrl) {
  if (typeof dataUrl !== 'string') throw badRequest('Logo inválida.');
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) throw badRequest('A logo deve ser uma imagem PNG, JPG ou WEBP.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw badRequest('Logo inválida.');
  if (buf.length > MAX_LOGO_BYTES) throw badRequest('A logo deve ter no máximo 512 KB.');
  const mime = sniffImage(buf);
  if (!mime) throw badRequest('O arquivo enviado não é uma imagem PNG, JPG ou WEBP válida.');
  return { buf, mime };
}

async function getBranding() {
  const { rows } = await query(
    `SELECT name, logo IS NOT NULL AS has_logo, setup_done_at IS NOT NULL AS configured,
            extract(epoch FROM updated_at)::bigint AS version
       FROM shop_settings WHERE id = 1`);
  const r = rows[0] || { name: null, has_logo: false, configured: false, version: 0 };
  return { name: r.name, hasLogo: r.has_logo, configured: r.configured, version: Number(r.version) };
}

async function getLogo() {
  const { rows } = await query('SELECT logo, logo_mime, extract(epoch FROM updated_at)::bigint AS version FROM shop_settings WHERE id = 1 AND logo IS NOT NULL');
  return rows[0] || null;
}

/** body: { name, logo } — logo: data URL (trocar), null (remover), ausente (manter). */
async function updateBranding(body, userId) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > MAX_NAME) throw badRequest(`O nome deve ter no máximo ${MAX_NAME} caracteres.`);
  const changes = { name: name || null };
  const params = [changes.name, userId];
  let logoSql = '';
  if (body.logo === null) {
    logoSql = ', logo = NULL, logo_mime = NULL';
    changes.logo = 'removida';
  } else if (body.logo !== undefined) {
    const { buf, mime } = parseLogo(body.logo);
    params.push(buf, mime);
    logoSql = ', logo = $3, logo_mime = $4';
    changes.logo = `${mime}, ${buf.length} bytes`;
  }
  await query(`UPDATE shop_settings SET name = $1, updated_by = $2, updated_at = now(),
    setup_done_at = COALESCE(setup_done_at, now())${logoSql} WHERE id = 1`, params);
  return { branding: await getBranding(), changes };
}

/** Dispensa a configuração do primeiro acesso sem alterar nome/logo. Retorna false se já estava feita. */
async function skipSetup() {
  const r = await query('UPDATE shop_settings SET setup_done_at = now() WHERE id = 1 AND setup_done_at IS NULL');
  return r.rowCount > 0;
}

module.exports = { getBranding, skipSetup, getLogo, updateBranding, sniffImage, MAX_LOGO_BYTES };
