#!/usr/bin/env node
/*
 * Controle do servidor MotoControl: iniciar, parar, reiniciar e consultar o status.
 * Usado por iniciar.bat / parar.bat (Windows) e iniciar.sh / parar.sh (Linux).
 *
 *   node scripts/control.js start [--open]   inicia (se ainda não estiver rodando) e, com --open, abre o navegador
 *   node scripts/control.js stop             para o servidor
 *   node scripts/control.js restart [--open]
 *   node scripts/control.js status           código de saída 0 = rodando, 1 = parado
 *   node scripts/control.js rede             diagnostica o acesso pelos outros computadores da rede
 *
 * Se a inicialização automática foi configurada pelo instalador (tarefa "MotoControl" no Windows
 * ou serviço systemd "motocontrol" no Linux), ela é usada; caso contrário o servidor é iniciado
 * em segundo plano, com saída em motocontrol.log.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
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

function health(timeout = 2000, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get({ host, port: PORT, path: '/api/health', timeout }, (res) => {
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

// ---------------------------------------------------------------- diagnóstico de rede

const color = (c, t) => (process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t);
const ok = (t) => console.log(`  ${color('32', '✔')} ${t}`);
const bad = (t) => console.log(`  ${color('31', '✖')} ${t}`);
const warn = (t) => console.log(`  ${color('33', '!')} ${t}`);
const info = (t) => console.log(`    ${color('90', t)}`);

/** Endereços IPv4 desta máquina na rede local. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const isAdmin = () => (IS_WIN
  ? run('net', ['session']).status === 0
  : typeof process.getuid === 'function' && process.getuid() === 0);

/** A regra de firewall criada pelo instalador existe? null = não foi possível verificar. */
function firewallRule() {
  if (IS_WIN) {
    // O código de saída não depende do idioma do Windows: 0 = a regra existe.
    return run('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=MotoControl']).status === 0;
  }
  const r = run('ufw', ['status']);
  if (r.status !== 0) return null; // ufw ausente ou sem permissão: nada a concluir
  if (!/Status:\s*active/i.test(r.stdout)) return null; // firewall desligado: a porta não está bloqueada
  return new RegExp(`(^|\\s)${PORT}(/tcp)?\\s`, 'm').test(r.stdout);
}

/** Perfis das redes conectadas no Windows (Private/Public/DomainAuthenticated). */
function networkProfiles() {
  if (!IS_WIN) return null;
  const r = run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-NetConnectionProfile | ForEach-Object { "$($_.Name)|$($_.NetworkCategory)" }) -join ";"']);
  if (r.status !== 0 || !r.stdout.trim()) return null;
  return r.stdout.trim().split(';').filter(Boolean).map((linha) => {
    const [nome, categoria] = linha.split('|');
    return { nome, categoria };
  });
}

/*
 * Diagnostica, em ordem, as três causas de "não consigo acessar de outro computador":
 * servidor parado, servidor escutando só em localhost e porta bloqueada pelo firewall.
 */
async function rede() {
  let problemas = 0;

  console.log(`\n${color('1', 'Diagnóstico de rede do MotoControl')}\n`);

  // 1. Servidor no ar ---------------------------------------------
  if (await health()) {
    ok(`Servidor respondendo na porta ${PORT}`);
  } else {
    bad(`Servidor não responde em http://localhost:${PORT}`);
    info('Inicie com iniciar.bat (Windows) ou ./iniciar.sh (Linux) e rode este comando de novo.');
    console.log('');
    process.exit(1);
  }

  // 2. HOST e bind ------------------------------------------------
  const host = (env && env.HOST) || process.env.HOST || '0.0.0.0';
  const ips = lanAddresses();

  if (host !== '0.0.0.0') {
    bad(`HOST está como "${host}" no arquivo .env`);
    info('Troque para HOST=0.0.0.0 e reinicie o servidor. Só assim ele aceita os outros computadores.');
    problemas++;
  } else if (!ips.length) {
    bad('Este computador não está conectado a nenhuma rede');
    info('Conecte o cabo de rede ou o Wi-Fi da oficina.');
    problemas++;
  } else if (await health(2000, ips[0])) {
    ok(`Servidor aceita conexões da rede (testado em ${ips[0]})`);
  } else {
    bad(`Servidor não respondeu em ${ips[0]}, apenas em localhost`);
    info('Confirme HOST=0.0.0.0 no arquivo .env e reinicie o servidor.');
    problemas++;
  }

  // 3. Firewall ---------------------------------------------------
  const regra = firewallRule();
  if (regra === true) {
    ok('Porta liberada no firewall (regra "MotoControl")');
  } else if (regra === false) {
    bad('A porta não está liberada no firewall');
    if (IS_WIN) {
      info('Rode instalar.bat como administrador, ou crie a regra manualmente em um Prompt de administrador:');
      info(`netsh advfirewall firewall add rule name="MotoControl" dir=in action=allow protocol=TCP localport=${PORT} remoteip=localsubnet`);
    } else {
      info(`Libere com: sudo ufw allow ${PORT}/tcp`);
    }
    problemas++;
  } else {
    warn(IS_WIN && !isAdmin()
      ? 'Não foi possível verificar o firewall (rode como administrador para checar)'
      : 'Não foi possível verificar o firewall');
  }

  // 4. Perfil da rede no Windows ----------------------------------
  const perfis = networkProfiles();
  if (perfis) {
    const publicas = perfis.filter((p) => p.categoria === 'Public');
    if (!publicas.length) {
      ok('Redes classificadas como particulares');
    } else {
      bad(`Rede classificada como Pública: ${publicas.map((p) => p.nome).join(', ')}`);
      info('No perfil Público o Windows bloqueia a entrada mesmo com a regra criada.');
      info('Configurações → Rede e Internet → clique na rede → marque "Rede particular".');
      problemas++;
    }
  }

  // 5. Endereços --------------------------------------------------
  if (ips.length) {
    console.log(`\n${color('1', 'Endereços para os outros computadores')}\n`);
    for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
    info('Nos outros computadores use este endereço, nunca "localhost".');
    if (ips.length > 1) info('Mais de uma rede: use o endereço da rede em que estão os outros computadores.');
    info('Se o endereço mudar sozinho, peça para reservar o IP deste computador no roteador.');
  }

  // Conclusão -----------------------------------------------------
  console.log('');
  if (problemas) {
    console.log(color('33', `${problemas} problema(s) encontrado(s). Resolva os itens marcados com ✖ acima.`));
  } else {
    console.log(color('32', 'Nenhum problema encontrado neste computador.'));
    info('Se ainda assim não abrir nos outros, verifique se eles estão na mesma rede');
    info('e se o Wi-Fi não está com isolamento de clientes (comum em redes de visitantes).');
  }
  console.log('');
  process.exit(problemas ? 1 : 0);
}

(async () => {
  const [cmd = 'status'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const open = process.argv.includes('--open');
  switch (cmd) {
    case 'start': await start(open); break;
    case 'stop': await stop(); break;
    case 'restart': await stop(); await start(open); break;
    case 'open': openBrowser(); break;
    case 'rede': await rede(); break;
    case 'status': {
      const up = await health();
      console.log(up ? `Em execução: ${URL}` : 'Parado.');
      process.exit(up ? 0 : 1);
      break;
    }
    default:
      console.error('Uso: node scripts/control.js start|stop|restart|status|open|rede [--open]');
      process.exit(2);
  }
})();
