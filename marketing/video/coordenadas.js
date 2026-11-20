// Uso: node coordenadas.js > rects.json  (com o sistema rodando e dados de demonstração)
// Coordenadas (em pixels da captura 1920x1080) dos elementos a destacar no vídeo.
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
(async () => {
  const b = await chromium.launch();
  const out = {};
  const grab = async (user, pass, hash, prep, sels) => {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
    const p = await ctx.newPage();
    await p.goto(BASE); await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass);
    await p.click('button[type=submit]'); await p.waitForSelector('.page');
    await p.goto(`${BASE}/#${hash}`); await p.waitForTimeout(600);
    if (prep) await prep(p);
    const r = {};
    for (const [k, sel] of Object.entries(sels)) {
      r[k] = await p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 1.2)); }, sel);
    }
    await ctx.close();
    return r;
  };
  out.dashboard = await grab('joao', 'demo123', '/', null, { stats: '.stats', feed: '.grid-2 > .card:last-child' });
  out.nova = await grab('joao', 'demo123', '/comandas/nova', async (p) => {
    await p.fill('[data-moto-search]', 'XYZ'); await p.waitForSelector('.picker-list li[data-i]'); await p.click('.picker-list li[data-i]'); await p.waitForTimeout(300);
  }, { moto: '.selected-moto', atendimento: '[data-form]' });
  out.historico = await grab('carlos', 'demo123', '/comandas/1', async (p) => {
    const y = await p.evaluate(() => document.querySelector('.timeline-form').getBoundingClientRect().top + scrollY - 140);
    await p.evaluate((yy) => scrollTo(0, yy), y); await p.waitForTimeout(300);
  }, { timeline: '.timeline', itens: '.card:has([data-add-item])' });
  out.moto = await grab('carlos', 'demo123', '/motos/1', null, { history: '.history', info: '.card' });
  out.funcionarios = await grab('admin', 'admin123', '/usuarios', null, { tabela: 'table' });
  out.admin = await grab('admin', 'admin123', '/administracao', null, { backups: '.card' });
  console.log(JSON.stringify(out));
  await b.close();
})();
