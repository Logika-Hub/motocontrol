/*
 * Leitura pública da identidade da oficina (nome e logo), fora de /api:
 * a tela de entrada precisa exibi-la antes do login. Só leitura; a alteração fica em
 * PUT /api/admin/branding, com requirePermission.
 */
const express = require('express');
const { getBranding, getLogo } = require('../services/branding');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-cache');
    res.json(await getBranding());
  } catch (err) { next(err); }
});

router.get('/logo', async (req, res, next) => {
  try {
    const logo = await getLogo();
    if (!logo) return res.status(404).end();
    const etag = `"logo-${logo.version}"`;
    res.set({ 'Cache-Control': 'no-cache', ETag: etag, 'Content-Type': logo.logo_mime });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    return res.send(logo.logo);
  } catch (err) { return next(err); }
});

module.exports = router;
