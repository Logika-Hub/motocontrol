// Identidade da oficina (nome e logo), lida de /marca — pública, para aparecer também na tela de entrada.
// Sem nome nem logo cadastrados, tudo continua como "MotoControl".
import { html, raw } from './ui.js';

let cache = null;

export async function loadBrand(force = false) {
  if (cache && !force) return cache;
  try {
    const r = await fetch('/marca', { headers: { Accept: 'application/json' } });
    cache = r.ok ? await r.json() : { name: null, hasLogo: false, version: 0 };
  } catch {
    cache = { name: null, hasLogo: false, version: 0 };
  }
  document.title = cache.name ? `${cache.name} · MotoControl` : 'MotoControl';
  return cache;
}

export const brandName = (b) => (b && b.name) || 'MotoControl';
export const logoUrl = (b) => (b && b.hasLogo ? `/marca/logo?v=${b.version}` : null);

/** Logo (ou ícone padrão) + nome. Com logo cadastrada, o nome só aparece se `withName`. */
export function brandMark(b, { withName = true, cls = '' } = {}) {
  const url = logoUrl(b);
  const img = url
    ? html`<img class="shop-logo ${cls}" src="${url}" alt="${brandName(b)}">`
    : html`<img class="${cls}" src="/favicon.svg" alt="">`;
  const showName = withName || !url;
  return html`${raw(img)}${showName ? raw(html`<span class="brand-name">${brandName(b)}</span>`) : ''}`;
}
