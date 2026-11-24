const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const env = require('./server/config/env');
const { pool } = require('./server/config/db');
const { loadUser, requireAuth } = require('./server/middlewares/auth');
const errorHandler = require('./server/middlewares/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  // A logo da oficina chega como data URL (até 512 KB de imagem ≈ 700 KB em base64); só esta rota aceita mais.
  app.put('/api/admin/branding', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(session({
    name: 'motocontrol.sid',
    store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false }),
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: false, // rede local via HTTP; ativar se houver HTTPS
      maxAge: env.sessionMaxAgeHours * 3600 * 1000,
    },
  }));
  app.use(loadUser);

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });
  api.use('/auth', require('./server/routes/auth'));
  api.use(requireAuth);
  api.use('/dashboard', require('./server/routes/dashboard'));
  api.use('/users', require('./server/routes/users'));
  api.use('/customers', require('./server/routes/customers'));
  api.use('/motorcycles', require('./server/routes/motorcycles'));
  api.use('/work-orders', require('./server/routes/workOrders'));
  api.use('/admin', require('./server/routes/admin'));
  api.use('/tickets', require('./server/routes/tickets'));
  api.use('/sales', require('./server/routes/sales'));
  api.use('/finance', require('./server/routes/finance'));
  api.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  app.use('/api', api);
  app.use('/marca', require('./server/routes/branding'));
  app.use('/ajuda', require('./server/routes/help'));
  app.use('/ajuda', (_req, res) => res.status(404).send('Página de ajuda não encontrada. <a href="/ajuda/">Voltar ao índice</a>'));
  app.use(express.static(path.join(__dirname, 'client'), { index: 'index.html' }));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));
  app.use(errorHandler);
  return app;
}

// Arquivo com o PID do servidor, usado por scripts/control.js (iniciar/parar).
const PID_FILE = path.join(__dirname, 'motocontrol.pid');
function writePidFile() {
  const fs = require('fs');
  fs.writeFileSync(PID_FILE, String(process.pid));
  const cleanup = () => { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch { /* já removido */ } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => process.exit(0));
}

if (require.main === module) {
  const { migrate } = require('./database/migrate');
  const { scheduleBackups } = require('./server/services/backup');
  migrate()
    .then(() => {
      const server = createApp().listen(env.port, env.host, () => {
        console.log(`MotoControl em execução: http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}`);
        console.log('Na rede local, acesse pelo IP deste computador (ex.: http://192.168.0.100:%d).', env.port);
        writePidFile();
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') console.error(`A porta ${env.port} já está em uso — o MotoControl provavelmente já está em execução.`);
        else console.error(err);
        process.exit(1);
      });
      scheduleBackups();
    })
    .catch((err) => {
      console.error('Falha ao iniciar:', err);
      process.exit(1);
    });
}

module.exports = { createApp };
