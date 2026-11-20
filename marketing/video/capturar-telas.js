// Capturas limpas para o vídeo (16:9) e correção de duas imagens do manual.
const { chromium } = require('playwright');
// Uso: node capturar-telas.js shots ../../docs/manual/imagens  (com o sistema rodando e dados de demonstração)
const [OUT, MANUAL] = process.argv.slice(2);
const BASE = 'http://localhost:3000';
(async () => {
  const b = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR:pt', LC_ALL: 'pt_BR.UTF-8' } });
  const mk = (w, h, dsf) => b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, locale: 'pt-BR' });
  async function login(ctx, u, p = 'demo123') {
    const page = await ctx.newPage();
    await page.goto(BASE); await page.waitForSelector('input[name=username]');
    await page.fill('input[name=username]', u); await page.fill('input[name=password]', p);
    await page.click('button[type=submit]'); await page.waitForSelector('.page');
    return page;
  }
  const settle = (p) => p.waitForTimeout(400);
  const noToasts = (p) => p.evaluate(() => document.getElementById('toasts').replaceChildren());

  for (const [w, h, dsf, dir, isManual] of [[1600, 900, 1.2, OUT, false], [1280, 800, 1.5, MANUAL, true]]) {
    // Atendente: nova comanda
    let ctx = await mk(w, h, dsf); let p = await login(ctx, 'joao');
    await p.goto(`${BASE}/#/comandas/nova`); await p.fill('[data-moto-search]', 'XYZ');
    await p.waitForSelector('.picker-list li[data-i]'); await p.click('.picker-list li[data-i]');
    await p.fill('textarea[name=complaint]', 'Corrente fazendo barulho e luz do farol piscando.');
    await p.fill('input[name=entryKm]', '41500');
    await p.fill('input[name=expectedDelivery]', '2026-11-22');
    await p.click('h1'); await noToasts(p); await settle(p);
    await p.screenshot({ path: `${dir}/nova-comanda.png` });
    if (!isManual) {
      await p.goto(`${BASE}/#/`); await p.waitForSelector('.stats'); await settle(p);
      await p.screenshot({ path: `${dir}/dashboard.png` });
    }
    await ctx.close();

    // Mecânico: comanda, histórico, moto
    ctx = await mk(w, h, dsf); p = await login(ctx, 'carlos');
    if (!isManual) {
      await p.goto(`${BASE}/#/comandas/1`); await p.waitForSelector('.timeline'); await settle(p);
      await p.screenshot({ path: `${dir}/comanda.png` });
      const y = await p.evaluate(() => document.querySelector('.timeline-form').getBoundingClientRect().top + scrollY - 140);
      await p.evaluate((yy) => scrollTo(0, yy), y); await settle(p);
      await p.screenshot({ path: `${dir}/historico.png` });
    }
    await p.goto(`${BASE}/#/motos/1`); await p.waitForSelector('.history'); await noToasts(p); await settle(p);
    await p.screenshot({ path: `${dir}/moto-historico.png` });
    await ctx.close();

    if (!isManual) {
      ctx = await mk(w, h, dsf); p = await login(ctx, 'admin', 'admin123');
      await p.goto(`${BASE}/#/usuarios`); await p.waitForSelector('table'); await settle(p);
      await p.screenshot({ path: `${dir}/funcionarios.png` });
      await p.goto(`${BASE}/#/administracao`); await p.waitForSelector('[data-backups]'); await settle(p);
      await p.screenshot({ path: `${dir}/administracao.png` });
      await p.goto(`${BASE}/#/comandas/1`); await p.waitForSelector('.timeline');
      await p.emulateMedia({ media: 'print' });
      await p.pdf({ path: `${dir}/comanda.pdf`, format: 'A4', preferCSSPageSize: true });
      await ctx.close();
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
