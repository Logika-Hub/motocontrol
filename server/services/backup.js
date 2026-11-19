const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const env = require('../config/env');

const run = promisify(execFile);
const dir = () => path.resolve(env.backupDir);
const FILE_RE = /^motocontrol-\d{8}-\d{6}\.dump$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Gera um backup completo no formato custom do pg_dump (compactado, restaurável com pg_restore). */
async function createBackup() {
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), `motocontrol-${stamp()}.dump`);
  await run(process.env.PG_DUMP_PATH || 'pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, env.databaseUrl], {
    maxBuffer: 16 * 1024 * 1024,
  });
  prune();
  const { size } = fs.statSync(file);
  return { file: path.basename(file), size };
}

function listBackups() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir())
    .filter((f) => FILE_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir(), f));
      return { file: f, size: st.size, created_at: st.mtime };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

/** Mantém apenas os N backups mais recentes (BACKUP_KEEP). */
function prune() {
  for (const b of listBackups().slice(env.backupKeep)) fs.unlinkSync(path.join(dir(), b.file));
}

function backupPath(file) {
  if (!FILE_RE.test(file)) return null;
  const full = path.join(dir(), file);
  return fs.existsSync(full) ? full : null;
}

/** Restaura um backup, substituindo os dados atuais. Usado pelo script de linha de comando. */
async function restoreBackup(fileOrPath) {
  const full = fs.existsSync(fileOrPath) ? fileOrPath : backupPath(fileOrPath);
  if (!full) throw new Error(`Backup não encontrado: ${fileOrPath}`);
  await run(process.env.PG_RESTORE_PATH || 'pg_restore',
    ['--clean', '--if-exists', '--no-owner', '--single-transaction', `--dbname=${env.databaseUrl}`, full],
    { maxBuffer: 16 * 1024 * 1024 });
  return full;
}

/** Agenda backups automáticos (RNF07). BACKUP_INTERVAL_HOURS=0 desativa. */
function scheduleBackups(logger = console) {
  if (!env.backupIntervalHours) return null;
  const ms = env.backupIntervalHours * 3600 * 1000;
  const tick = () => createBackup()
    .then((b) => logger.log(`[backup] gerado ${b.file} (${b.size} bytes)`))
    .catch((e) => logger.error('[backup] falhou:', e.message));
  // Primeiro backup alguns minutos após iniciar, depois no intervalo configurado.
  const first = setTimeout(tick, 5 * 60 * 1000);
  const timer = setInterval(tick, ms);
  first.unref();
  timer.unref();
  return timer;
}

module.exports = { createBackup, listBackups, backupPath, restoreBackup, scheduleBackups };
