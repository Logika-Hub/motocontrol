/*
 * Ajuda dentro do sistema: publica o manual do usuário (docs/manual/*.md) como páginas HTML
 * em /ajuda/. O mesmo arquivo Markdown é lido no GitHub e aqui — uma única fonte.
 * Não exige login, para que a tela de entrada também possa apontar para a ajuda.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { marked } = require('marked');

const MANUAL_DIR = path.join(__dirname, '..', '..', 'docs', 'manual');
const router = express.Router();

// Mesmo padrão de âncoras do GitHub: "Ficha da motocicleta e histórico" -> "ficha-da-motocicleta-e-histórico"
const slugify = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')
  .replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pages() {
  return fs.readdirSync(MANUAL_DIR)
    .filter((f) => /^\d{2}-.+\.md$/.test(f))
    .sort()
    .map((f) => {
      const firstLine = fs.readFileSync(path.join(MANUAL_DIR, f), 'utf8').split('\n')[0];
      return { slug: f.replace(/\.md$/, ''), title: firstLine.replace(/^#\s*/, '').trim() };
    });
}

function render(file, slug) {
  const md = fs.readFileSync(file, 'utf8');
  // Links entre páginas do manual: "02-comandas.md#secao" -> "02-comandas#secao"
  const body = marked.parse(md).replace(/href="(\d{2}-[^"#]+)\.md(#[^"]*)?"/g, 'href="$1$2"')
    .replace(/href="README\.md(#[^"]*)?"/g, 'href="./$1"')
    .replace(/<h([23])>(.*?)<\/h\1>/g, (_m, n, inner) => `<h${n} id="${esc(slugify(inner))}">${inner}</h${n}>`);
  const list = pages();
  const nav = [{ slug: '', title: 'Início' }, ...list]
    .map((p) => `<a href="./${p.slug}" class="${p.slug === slug ? 'active' : ''}">${esc(p.title)}</a>`).join('');
  const idx = list.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? list[idx - 1] : idx === 0 ? { slug: '', title: 'Início' } : null;
  const next = idx < list.length - 1 ? list[idx + 1] : null;
  const title = (md.split('\n')[0] || '').replace(/^#\s*/, '');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Ajuda do MotoControl</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles/ajuda.css"></head>
<body>
<header class="help-top"><a class="brand" href="./"><img src="/favicon.svg" alt=""> Ajuda do MotoControl</a><a class="back-app" href="/">Voltar ao sistema</a></header>
<div class="help-layout">
  <nav class="help-nav">${nav}</nav>
  <main class="help-content">${body}
    <footer class="help-pager">
      ${prev ? `<a href="./${prev.slug}">‹ ${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a href="./${next.slug}">${esc(next.title)} ›</a>` : '<span></span>'}
    </footer>
  </main>
</div>
</body></html>`;
}

// /ajuda -> /ajuda/ (para os links relativos e as imagens funcionarem)
router.get('/', (req, res, next) => {
  if (!req.originalUrl.endsWith('/')) return res.redirect(301, `${req.baseUrl}/`);
  try {
    res.type('html').send(render(path.join(MANUAL_DIR, 'README.md'), ''));
  } catch (err) { next(err); }
});

router.use('/imagens', express.static(path.join(MANUAL_DIR, 'imagens'), { maxAge: '1d' }));

router.get('/:slug', (req, res, next) => {
  const slug = req.params.slug.replace(/\.md$/, '');
  if (!/^\d{2}-[a-z0-9-]+$/.test(slug)) return next();
  const file = path.join(MANUAL_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return next();
  try {
    res.type('html').send(render(file, slug));
  } catch (err) { next(err); }
});

module.exports = router;
