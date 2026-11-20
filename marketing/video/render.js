// Renderiza video.html quadro a quadro e envia ao ffmpeg.
//   node render.js preview 3,10,25      -> PNGs de prévia em preview/
//   node render.js video saida.mp4 audio.wav
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const FPS = 30;
const [mode, a1, a2] = process.argv.slice(2);
const TL = JSON.parse(fs.readFileSync(path.join(DIR, 'timeline.json'), 'utf8'));
const RECTS = JSON.parse(fs.readFileSync(path.join(DIR, 'rects.json'), 'utf8'));

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.addInitScript(([tl, rects]) => { window.__TIMELINE__ = tl; window.__RECTS__ = rects; }, [TL, RECTS]);
  page.on('pageerror', (e) => { console.error('Erro na página:', e.message); process.exit(1); });
  await page.goto('file://' + path.join(DIR, 'video.html'));
  await page.evaluate(() => window.__ready);
  await page.evaluate(() => document.fonts.ready);

  if (mode === 'preview') {
    fs.mkdirSync(path.join(DIR, 'preview'), { recursive: true });
    for (const t of a1.split(',').map(Number)) {
      await page.evaluate((tt) => window.renderAt(tt), t);
      await page.screenshot({ path: path.join(DIR, 'preview', `t${String(t).padStart(5, '0')}.png`) });
    }
  } else {
    const total = Math.ceil(TL.duracao * FPS);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-i', a2, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', a1], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((tt) => window.renderAt(tt), i / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 300 === 0) console.log(`quadro ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`pronto em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await b.close();
})();
