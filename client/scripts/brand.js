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

const MAX_SIDE = 512;
const MAX_BYTES = 512 * 1024;

// Redimensiona no navegador (lado maior até 512 px) e reencoda: o servidor recebe sempre um arquivo pequeno
// e limpo (sem metadados). PNG preserva transparência; se ficar grande demais, cai para JPEG.
export function prepareLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error('Escolha uma imagem PNG, JPG ou WEBP.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('O arquivo não parece ser uma imagem válida.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        let url = canvas.toDataURL('image/png');
        if (url.length * 0.75 > MAX_BYTES) {
          const flat = document.createElement('canvas');
          flat.width = canvas.width; flat.height = canvas.height;
          const g = flat.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, flat.width, flat.height); g.drawImage(canvas, 0, 0);
          url = flat.toDataURL('image/jpeg', 0.88);
        }
        if (url.length * 0.75 > MAX_BYTES) { reject(new Error('Imagem muito grande mesmo após reduzir. Use um arquivo mais simples.')); return; }
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
