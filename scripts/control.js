#!/usr/bin/env node
/*
 * Controle do servidor MotoControl: iniciar, parar, reiniciar e consultar o status.
 * Usado por iniciar.bat / parar.bat (Windows) e iniciar.sh / parar.sh (Linux).
 *
 *   node scripts/control.js start [--open]   inicia (se ainda não estiver rodando) e, com --open, abre o navegador
 *   node scripts/control.js stop             para o servidor
 *   node scripts/control.js restart [--open]
 *   node scripts/control.js status           código de saída 0 = rodando, 1 = parado
 *
 * Se a inicialização automática foi configurada pelo instalador (tarefa "MotoControl" no Windows
 * ou serviço systemd "motocontrol" no Linux), ela é usada; caso contrário o servidor é iniciado
 * em segundo plano, com saída em motocontrol.log.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(ROOT, 'motocontrol.pid');
const LOG_FILE = path.join(ROOT, 'motocontrol.log');
const IS_WIN = process.platform === 'win32';

function readEnv() {
  const env = {};
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = readEnv();
const PORT = Number((env && env.PORT) || process.env.PORT || 3000);
const URL = `http://localhost:${PORT}`;
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });

function health(timeout = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(expectRunning, seconds) {
  for (let i = 0; i < seconds; i++) {
    if ((await health()) === expectRunning) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (!pid) return null;
    process.kill(pid, 0); // lança erro se o processo não existe (EPERM = existe, mas de outro usuário)
    return pid;
  } catch (err) {
    return err.code === 'EPERM' ? Number(fs.readFileSync(PID_FILE, 'utf8').trim()) : null;
  }
}

const hasWinTask = () => IS_WIN && run('schtasks', ['/Query', '/TN', 'MotoControl']).status === 0;
const hasSystemd = () => !IS_WIN && fs.existsSync('/etc/systemd/system/motocontrol.service') && fs.existsSync('/run/systemd/system');

function openBrowser() {
  if (IS_WIN) spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else if (process.platform === 'darwin') spawn('open', [URL], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [URL], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

async function start(open) {
  if (!env) {
    console.error('O MotoControl ainda não foi instalado neste computador. Execute primeiro o instalador (instalar.bat ou instalar.sh).');
    process.exit(1);
  }
  if (await health()) {
    console.log(`O MotoControl já está em execução: ${URL}`);
  } else {
    console.log('Iniciando o MotoControl...');
    if (hasWinTask()) {
      run('schtasks', ['/Run', '/TN', 'MotoControl']);
    } else if (hasSystemd()) {
      const r = run('systemctl', ['start', 'motocontrol']);
      if (r.status !== 0) console.error(`Não foi possível iniciar o serviço (tente com sudo): ${r.stderr.trim()}`);
    } else {
      const out = fs.openSync(LOG_FILE, 'a');
      spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT, detached: true, stdio: ['ignore', out, out], windowsHide: true,
      }).unref();
    }
    if (!(await waitFor(true, 45))) {
      console.error(`O MotoControl não respondeu. Veja o registro de erros em ${hasSystemd() ? 'journalctl -u motocontrol -n 50' : LOG_FILE}`);
      process.exit(1);
    }
    console.log(`MotoControl em execução: ${URL}`);
  }
  if (open) openBrowser();
}

async function stop() {
  if (!(await health()) && !readPid()) {
    console.log('O MotoControl não está em execução.');
    return;
  }
  console.log('Parando o MotoControl...');
  if (hasWinTask()) run('schtasks', ['/End', '/TN', 'MotoControl']);
  if (hasSystemd()) run('systemctl', ['stop', 'motocontrol']);
  const pid = readPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      if (err.code === 'EPERM') {
        console.error(IS_WIN ? 'Sem permissão para parar o servidor. Execute parar.bat como administrador.'
          : 'Sem permissão para parar o servidor. Execute com sudo.');
        process.exit(1);
      }
    }
  }
  if (!(await waitFor(false, 15))) {
    console.error('O servidor não parou. Reinicie o computador ou encerre o processo "node" no Gerenciador de Tarefas.');
    process.exit(1);
  }
  console.log('MotoControl parado.');
}

(async () => {
  const [cmd = 'status'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const open = process.argv.includes('--open');
  switch (cmd) {
    case 'start': await start(open); break;
    case 'stop': await stop(); break;
    case 'restart': await stop(); await start(open); break;
    case 'open': openBrowser(); break;
    case 'status': {
      const up = await health();
      console.log(up ? `Em execução: ${URL}` : 'Parado.');
      process.exit(up ? 0 : 1);
      break;
    }
    default:
      console.error('Uso: node scripts/control.js start|stop|restart|status|open [--open]');
      process.exit(2);
  }
})();
