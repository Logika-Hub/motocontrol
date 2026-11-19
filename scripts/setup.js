#!/usr/bin/env node
/*
 * Instalador do MotoControl (Windows e Linux).
 *
 * Executa, de forma idempotente (pode rodar de novo sem estragar nada):
 *   1. verifica Node.js e PostgreSQL
 *   2. instala as dependências (npm ci)
 *   3. faz TODAS as perguntas de uma vez (senha do banco, senha do admin, suspensão);
 *      daqui em diante a instalação segue sem interação
 *   4. instala o PostgreSQL (Windows, se faltar) e cria o usuário e o banco "motocontrol"
 *   5. gera o arquivo .env (SESSION_SECRET aleatório, caminhos do pg_dump)
 *   6. cria as tabelas e o usuário "admin"
 *   7. registra a inicialização automática (systemd no Linux, Agendador de Tarefas no Windows),
 *      libera a porta no firewall e cria os atalhos
 *   8. inicia o sistema, testa e mostra o endereço de acesso na rede
 *
 * Uso normal: execute instalar.bat (Windows) ou sudo ./instalar.sh (Linux).
 * Direto:      node scripts/setup.js [opções]
 *
 * Opções:
 *   --yes            não faz perguntas (usa variáveis de ambiente ou valores gerados)
 *   --no-service     não registra a inicialização automática
 *   --no-shortcuts   não cria atalhos na área de trabalho/menu Iniciar (Windows)
 *   --reinstall-deps reinstala as dependências mesmo que já estejam na pasta
 *   --port=3000      porta HTTP
 *   --db-name=nome   nome do banco (padrão: motocontrol)
 *
 * Variáveis de ambiente aceitas no modo --yes:
 *   PG_SUPERUSER (padrão postgres), PG_SUPERUSER_PASSWORD, PG_HOST, PG_PORT, ADMIN_PASSWORD
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const IS_WIN = process.platform === 'win32';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const AUTO = flag('yes');
const PORT = Number(opt('port', process.env.PORT || 3000));
const DB_NAME = opt('db-name', 'motocontrol');
const DB_USER = DB_NAME;

// ---------------------------------------------------------------- saída
const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const STEPS = 8;
const step = (n, s) => console.log(`\n${color('1;36', `[${n}/${STEPS}]`)} ${color('1', s)}`);
const ok = (s) => console.log(`  ${color('32', '✔')} ${s}`);
const info = (s) => console.log(`  ${s}`);
const warn = (s) => console.log(`  ${color('33', '!')} ${s}`);
function fail(msg, hint) {
  console.error(`\n${color('31', '✖ ERRO:')} ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error('\nCorrija o problema e execute o instalador novamente — ele continua de onde parou.\n');
  process.exit(1);
}

// ---------------------------------------------------------------- perguntas
let rl;
function prompt() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return rl;
}
function ask(question, def = '') {
  if (AUTO) return Promise.resolve(def);
  return new Promise((resolve) => prompt().question(`  ${question}${def ? ` [${def}]` : ''}: `, (a) => resolve(a.trim() || def)));
}
async function askYesNo(question, def = true) {
  if (AUTO) return def;
  const a = (await ask(`${question} (${def ? 'S/n' : 's/N'})`)).toLowerCase();
  return a ? a.startsWith('s') || a.startsWith('y') : def;
}
/**
 * Windows: lê a senha com a caixa de senha nativa do PowerShell (Read-Host -AsSecureString, que
 * mostra "*"). O PowerShell fica com o console inteiro (stdio herdado) para que o prompt e os "*"
 * apareçam; a senha volta em Base64 por um arquivo temporário na pasta TEMP do usuário (acessível
 * só a ele e aos administradores), apagado logo após a leitura.
 * Retorna null se o PowerShell não estiver disponível ou falhar — aí usa-se a leitura do Node.
 */
const PS_HIDDEN_READ = [
  "$ErrorActionPreference = 'Stop'",
  '$s = Read-Host -AsSecureString',
  '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)',
  'try { $p = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }',
  'finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }',
  '[IO.File]::WriteAllText($env:MOTOCONTROL_SECRET_FILE, [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p)))',
].join('; ');

function readHiddenWithPowerShell(question, psBin = 'powershell') {
  if (rl) { rl.close(); rl = null; } // devolve o console ao PowerShell
  const file = path.join(os.tmpdir(), `motocontrol-${process.pid}-${randomHex(8)}.tmp`);
  process.stdout.write(`  ${question}: `);
  try {
    const r = spawnSync(psBin, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_HIDDEN_READ], {
      stdio: 'inherit', env: { ...process.env, MOTOCONTROL_SECRET_FILE: file },
    });
    if (r.error || r.status !== 0 || !fs.existsSync(file)) return null;
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64').toString('utf8');
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(file); } catch { /* não foi criado */ }
  }
}

let psPromptBroken = false;
function askHidden(question) {
  if (AUTO) return Promise.resolve('');
  if (IS_WIN && !psPromptBroken) {
    const answer = readHiddenWithPowerShell(question);
    if (answer !== null) return Promise.resolve(answer);
    psPromptBroken = true; // não tenta de novo; segue com a leitura do Node
    process.stdout.write('\n');
    warn('Não foi possível usar a caixa de senha do PowerShell; usando a leitura do terminal.');
  }
  const r = prompt();
  return new Promise((resolve) => {
    const write = r._writeToOutput;
    r._writeToOutput = (s) => { if (s.includes(question)) write.call(r, s); else if (!/^[\r\n]+$/.test(s)) write.call(r, '*'); else write.call(r, s); };
    r.question(`  ${question}: `, (a) => { r._writeToOutput = write; resolve(a); });
  });
}
async function askNewPassword(label, { min = 6, validate = () => null } = {}) {
  for (;;) {
    const p1 = await askHidden(`${label} (mínimo ${min} caracteres)`);
    if (p1.length < min) { warn('Senha muito curta.'); continue; }
    const problem = validate(p1);
    if (problem) { warn(problem); continue; }
    const p2 = await askHidden('Repita a senha');
    if (p1 !== p2) { warn('As senhas não conferem. Digite de novo.'); continue; }
    return p1;
  }
}

// ---------------------------------------------------------------- utilidades
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
function run(cmd, cmdArgs, options = {}) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: IS_WIN && /\.(cmd|bat)$/i.test(cmd), ...options });
}
function which(bin) {
  const r = run(IS_WIN ? 'where' : 'which', [bin]);
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}
function isAdmin() {
  if (IS_WIN) return run('net', ['session'], { stdio: 'ignore' }).status === 0;
  return typeof process.getuid === 'function' && process.getuid() === 0;
}
function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return null;
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/** Procura os binários do PostgreSQL (psql, pg_dump) no PATH ou nas pastas padrão do Windows. */
function findPgBin() {
  const inPath = which('pg_dump');
  if (inPath) return path.dirname(inPath);
  const candidates = [];
  if (IS_WIN) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const dir = path.join(base, 'PostgreSQL');
      if (!fs.existsSync(dir)) continue;
      for (const v of fs.readdirSync(dir).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(dir, v, 'bin'));
    }
  } else {
    const dir = '/usr/lib/postgresql';
    if (fs.existsSync(dir)) for (const v of fs.readdirSync(dir).sort((a, b) => Number(b) - Number(a))) candidates.push(path.join(dir, v, 'bin'));
  }
  return candidates.find((d) => fs.existsSync(path.join(d, IS_WIN ? 'pg_dump.exe' : 'pg_dump'))) || null;
}

// ---------------------------------------------------------------- etapas
const PG_PASSWORD_FILE = path.join(ROOT, 'postgres-superusuario.txt');

/** Senha do "postgres" gravada por versões antigas do instalador (ou pelo modo --yes). */
function passwordFromFile() {
  try {
    const lines = fs.readFileSync(PG_PASSWORD_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim());
    return lines.find((l) => /^[A-Za-z0-9]{12,}$/.test(l)) || '';
  } catch { return ''; }
}

/** Senha que pode ir com segurança para a linha de comando do instalador do PostgreSQL. */
function validPgPassword(p) {
  if (p.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (/[\s"'`^%!&|<>\\]/.test(p)) return 'Não use espaços nem os caracteres  " \' ` ^ % ! & | < > \\';
  return null;
}

/** Instalador local do PostgreSQL (pasta "instaladores" do pacote), se houver. */
function localPgInstaller() {
  const dir = path.join(ROOT, 'instaladores');
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).filter((f) => /^postgresql-.*-windows-x64\.exe$/i.test(f)).sort().pop() || null;
}

/** Instala o PostgreSQL no Windows com a senha do superusuário já definida na etapa de perguntas. */
function installPostgresWindows(password, generated) {
  const local = localPgInstaller();
  const pgArgs = ['--mode', 'unattended', '--unattendedmodeui', 'none', '--superpassword', password,
    '--serverport', '5432', '--disable-components', 'stackbuilder'];
  let r;
  if (local) {
    info(`Instalando o PostgreSQL a partir de instaladores\\${local} (pode levar alguns minutos)...`);
    r = run(path.join(ROOT, 'instaladores', local), pgArgs, { stdio: 'inherit' });
  } else {
    info('Baixando e instalando o PostgreSQL 17 pelo winget (pode levar alguns minutos)...');
    r = run('winget', ['install', '--id', 'PostgreSQL.PostgreSQL.17', '-e', '--silent',
      '--accept-package-agreements', '--accept-source-agreements', '--override', pgArgs.join(' ')], { stdio: 'inherit' });
  }
  if (r.status !== 0) fail(`A instalação do PostgreSQL falhou (código ${r.status}).`);
  if (generated) {
    fs.writeFileSync(PG_PASSWORD_FILE, [
      'Senha do usuário "postgres" do PostgreSQL, gerada na instalação automática do MotoControl:',
      password,
      'Guarde em local seguro e apague este arquivo.', '',
    ].join(os.EOL), { mode: 0o600 });
  }
  const pgBin = findPgBin();
  if (!pgBin) fail('O PostgreSQL foi instalado, mas o pg_dump não foi encontrado em Program Files\\PostgreSQL.');
  ok(`PostgreSQL instalado em ${pgBin}`);
  return pgBin;
}

function checkPrerequisites() {
  step(1, 'Verificando pré-requisitos');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) fail(`Node.js ${process.versions.node} é antigo demais (mínimo: 20).`, 'Instale a versão LTS em https://nodejs.org/');
  ok(`Node.js ${process.versions.node}`);
  const pgBin = findPgBin();
  if (pgBin) {
    ok(`PostgreSQL encontrado em ${pgBin}`);
  } else if (IS_WIN) {
    // Confere agora (antes das perguntas) se será possível instalar o PostgreSQL.
    const local = localPgInstaller();
    if (!local && !which('winget')) {
      fail('PostgreSQL não encontrado e não há instalador na pasta "instaladores" nem o winget para baixá-lo.',
        'Use o pacote completo gerado por "npm run pacote" ou instale o PostgreSQL: https://www.postgresql.org/download/windows/');
    }
    if (!isAdmin()) fail('Execute o instalar.bat como administrador: é preciso instalar o PostgreSQL.');
    info(`PostgreSQL não instalado — será instalado ${local ? `a partir de instaladores\\${local}` : 'pelo winget'}`);
  } else {
    fail('PostgreSQL não encontrado neste computador.', 'Execute sudo ./instalar.sh (instala automaticamente) ou: sudo apt install postgresql');
  }
  if (!isAdmin()) warn('Sem privilégios de administrador: a inicialização automática e o firewall não serão configurados.');
  return { pgBin, pgMissing: !pgBin };
}

/** Dependências já presentes (pacote offline gerado por "npm run pacote")? */
function depsPresent() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return Object.keys(pkg.dependencies || {}).every((d) => fs.existsSync(path.join(ROOT, 'node_modules', d, 'package.json')));
}

function installDeps() {
  step(2, 'Instalando dependências');
  if (depsPresent() && !flag('reinstall-deps')) {
    ok('Dependências já incluídas no pacote (instalação sem internet)');
    return;
  }
  const npm = IS_WIN ? 'npm.cmd' : 'npm';
  const hasLock = fs.existsSync(path.join(ROOT, 'package-lock.json'));
  const r = run(npm, [hasLock ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('Falha ao instalar as dependências (npm).', 'Verifique a conexão com a internet e tente novamente.');
  ok('Dependências instaladas');
}

/**
 * Executa SQL como superusuário do PostgreSQL. No Linux, executando como root, usa o usuário
 * de sistema "postgres" (autenticação local, sem senha). Caso contrário, conecta com usuário e senha.
 */
/** Logo após a instalação, o serviço do PostgreSQL pode levar alguns segundos para aceitar conexões. */
async function connectWithRetry(makeClient, seconds = 30) {
  for (let i = 0; ; i++) {
    const client = makeClient();
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (err.code !== 'ECONNREFUSED' || i >= seconds) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function superuserConnection() {
  if (!IS_WIN && isAdmin() && which('runuser') && !process.env.PG_SUPERUSER_PASSWORD) {
    const probe = run('runuser', ['-u', 'postgres', '--', 'psql', '-tAc', 'SELECT 1']);
    if (probe.status === 0) {
      ok('Conectado ao PostgreSQL como "postgres" (autenticação local)');
      return {
        async query(sql) {
          const r = run('runuser', ['-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
          if (r.status !== 0) throw new Error(r.stderr.trim());
          return r.stdout.trim();
        },
        async end() {},
      };
    }
  }
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const host = process.env.PG_HOST || 'localhost';
  const port = Number(process.env.PG_PORT || 5432);
  const user = process.env.PG_SUPERUSER || 'postgres';
  let password = process.env.PG_SUPERUSER_PASSWORD || passwordFromFile();
  if (!process.env.PG_SUPERUSER_PASSWORD && password) info(`Usando a senha do banco gravada em ${path.basename(PG_PASSWORD_FILE)}`);
  let explained = false;
  for (let attempt = 1; ; attempt++) {
    if (!password && !AUTO) {
      if (!explained) {
        info('O PostgreSQL já está instalado neste computador. Para criar o banco do MotoControl,');
        info(`informe a senha do usuário "${user}" — a que foi definida quando o PostgreSQL foi instalado.`);
        explained = true;
      }
      password = await askHidden(`Senha do usuário "${user}" do PostgreSQL`);
    }
    try {
      const client = await connectWithRetry(() => new Client({ host, port, user, password, database: 'postgres' }));
      ok(`Conectado ao PostgreSQL em ${host}:${port} como "${user}"`);
      return {
        async query(sql) { const r = await client.query(sql); return r.rows.map((x) => Object.values(x).join('|')).join('\n'); },
        end: () => client.end(),
      };
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        fail(`O PostgreSQL não está aceitando conexões em ${host}:${port}.`,
          IS_WIN ? 'Abra "Serviços" (services.msc) e inicie o serviço postgresql.' : 'Inicie com: sudo systemctl start postgresql');
      }
      if (err.code === '28P01' && !AUTO && attempt < 3) { warn('Senha incorreta.'); password = ''; continue; }
      if (err.code === '28P01') {
        fail('Senha do PostgreSQL incorreta.',
          'Se ninguém sabe essa senha, veja "Esqueci a senha do PostgreSQL" em docs/manual/06-servidor-e-backup.md.');
      }
      fail(`Não foi possível conectar ao PostgreSQL: ${err.message}`);
    }
  }
}

/** Já existe administrador no banco configurado no .env? (sem .env, não há como saber ainda) */
async function adminAlreadyExists(existingEnv) {
  if (!existingEnv || !existingEnv.DATABASE_URL) return false;
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const client = new Client({ connectionString: existingEnv.DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' LIMIT 1`);
    return rows.length > 0;
  } catch {
    return false; // banco ou tabelas ainda não existem
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Etapa de perguntas: tudo o que depende do usuário é perguntado (e conferido) aqui, de uma vez.
 * Depois dela a instalação não interage mais.
 */
async function collectAnswers(existingEnv, pgMissing) {
  step(3, 'Senhas e opções');
  const answers = { pgPassword: null, pgGenerated: false, dbConn: null, adminPassword: null, disableSleep: false };
  if (!AUTO) info(color('1', 'Responda agora: depois destas perguntas a instalação segue sozinha até o fim.'));

  // 1) Senha do banco de dados (superusuário "postgres")
  if (pgMissing) {
    let pw = process.env.PG_SUPERUSER_PASSWORD || '';
    if (pw && validPgPassword(pw)) fail(`PG_SUPERUSER_PASSWORD inválida: ${validPgPassword(pw)}`);
    if (!pw && !AUTO) {
      console.log('');
      info(color('1', 'Senha do BANCO DE DADOS (PostgreSQL, usuário "postgres")'));
      info('Não é usada no dia a dia, mas é necessária para reinstalar ou dar manutenção.');
      info(color('33', 'Anote-a em local seguro: ela não fica salva no computador.'));
      pw = await askNewPassword('Defina a senha do banco de dados', { min: 8, validate: validPgPassword });
    }
    if (!pw) { pw = randomHex(12); answers.pgGenerated = true; }
    answers.pgPassword = pw;
  } else if (!(existingEnv && existingEnv.DATABASE_URL)) {
    console.log('');
    answers.dbConn = await superuserConnection(); // pede a senha e já confere se está certa
  } else {
    ok('Banco já configurado (.env existente) — nenhuma senha do banco é necessária');
  }

  // 2) Senha do admin do MotoControl
  if (await adminAlreadyExists(existingEnv)) {
    ok('Já existe um administrador do MotoControl — a senha dele não será alterada');
  } else {
    let pw = process.env.ADMIN_PASSWORD || '';
    if (!pw && !AUTO) {
      console.log('');
      info(color('1', 'Senha do usuário "admin" do MotoControl (acesso completo ao sistema)'));
      pw = await askNewPassword('Defina a senha do admin');
    }
    answers.adminPassword = pw || null;
  }

  // 3) Suspensão do computador
  if (!flag('no-service') && isAdmin()) {
    console.log('');
    answers.disableSleep = await askYesNo('Impedir que este computador entre em suspensão (recomendado para o servidor)?', true);
  }
  if (!AUTO) { console.log(''); ok('Pronto! A instalação continua sem novas perguntas — pode levar alguns minutos.'); }
  return answers;
}

async function setupDatabase(existingEnv, pgMissing, answers) {
  step(4, 'Banco de dados');
  let pgBin = null;
  if (pgMissing) {
    pgBin = installPostgresWindows(answers.pgPassword, answers.pgGenerated);
    process.env.PG_SUPERUSER_PASSWORD = answers.pgPassword;
  }
  if (existingEnv && existingEnv.DATABASE_URL) {
    ok('Arquivo .env já existe — mantendo o banco configurado nele');
    return { databaseUrl: existingEnv.DATABASE_URL, pgBin };
  }
  const db = answers.dbConn || await superuserConnection();
  const dbPassword = randomHex(16);
  try {
    const roleExists = await db.query(`SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'`);
    if (roleExists) {
      await db.query(`ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${dbPassword}'`);
      ok(`Usuário "${DB_USER}" já existia — senha redefinida`);
    } else {
      await db.query(`CREATE ROLE "${DB_USER}" WITH LOGIN PASSWORD '${dbPassword}'`);
      ok(`Usuário "${DB_USER}" criado`);
    }
    const dbExists = await db.query(`SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`);
    if (dbExists) {
      ok(`Banco "${DB_NAME}" já existe — dados preservados`);
    } else {
      await db.query(`CREATE DATABASE "${DB_NAME}" OWNER "${DB_USER}" ENCODING 'UTF8' TEMPLATE template0`);
      ok(`Banco "${DB_NAME}" criado`);
    }
  } catch (err) {
    fail(`Falha ao configurar o banco: ${err.message}`);
  } finally {
    await db.end();
  }
  const host = process.env.PG_HOST || 'localhost';
  const port = process.env.PG_PORT || 5432;
  return { databaseUrl: `postgres://${DB_USER}:${dbPassword}@${host}:${port}/${DB_NAME}`, pgBin };
}

function writeEnv(existingEnv, databaseUrl, pgBin) {
  step(5, 'Gerando configuração (.env)');
  if (existingEnv && existingEnv.DATABASE_URL) {
    ok('Configuração existente mantida');
    return existingEnv;
  }
  const exe = (name) => path.join(pgBin, IS_WIN ? `${name}.exe` : name);
  const content = [
    '# Gerado pelo instalador do MotoControl. Não compartilhe este arquivo.',
    `# ${new Date().toISOString()}`,
    'NODE_ENV=production',
    `PORT=${PORT}`,
    'HOST=0.0.0.0',
    `DATABASE_URL=${databaseUrl}`,
    `SESSION_SECRET=${randomHex(32)}`,
    'SESSION_MAX_AGE_HOURS=12',
    'BACKUP_DIR=./backups',
    'BACKUP_INTERVAL_HOURS=24',
    'BACKUP_KEEP=30',
    `PG_DUMP_PATH=${exe('pg_dump')}`,
    `PG_RESTORE_PATH=${exe('pg_restore')}`,
    '',
  ].join(os.EOL);
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
  ok(`Arquivo ${ENV_FILE} criado`);
  return readEnvFile();
}

async function setupSchemaAndAdmin(env, answers) {
  step(6, 'Criando tabelas e o usuário administrador');
  Object.assign(process.env, env);
  const { pool } = require(path.join(ROOT, 'server', 'config', 'db'));
  const { migrate } = require(path.join(ROOT, 'database', 'migrate'));
  try {
    await migrate({ log: (m) => info(m) });
    ok('Estrutura do banco atualizada');
    const { rows } = await pool.query(`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' LIMIT 1`);
    if (rows.length) {
      ok('Já existe um administrador — nenhum usuário foi alterado');
      return null;
    }
    let password = answers.adminPassword || '';
    let generated = false;
    if (!password) { password = randomHex(5); generated = true; }
    const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
    await pool.query(
      `INSERT INTO users (role_id, name, username, password_hash, must_change_password)
       SELECT id, 'Administrador', 'admin', $1, $2 FROM roles WHERE code = 'admin'`,
      [await bcrypt.hash(password, 10), generated]);
    ok('Usuário "admin" criado');
    return generated ? password : null;
  } finally {
    await pool.end();
  }
}

function setupServiceLinux() {
  if (!fs.existsSync('/run/systemd/system')) {
    warn('systemd não encontrado: configure a inicialização automática manualmente (veja deploy/).');
    return false;
  }
  // Executa com o dono da pasta do projeto, não como root.
  const st = fs.statSync(ROOT);
  let user = process.env.SUDO_USER || '';
  if (!user) {
    const r = run('id', ['-nu', String(st.uid)]);
    user = r.status === 0 ? r.stdout.trim() : 'root';
  }
  const unit = `[Unit]
Description=MotoControl - gerenciamento de oficina
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${ROOT}
ExecStart=${process.execPath} app.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  fs.writeFileSync('/etc/systemd/system/motocontrol.service', unit);
  for (const a of [['daemon-reload'], ['enable', 'motocontrol'], ['restart', 'motocontrol']]) {
    const r = run('systemctl', a);
    if (r.status !== 0) { warn(`systemctl ${a.join(' ')} falhou: ${r.stderr.trim()}`); return false; }
  }
  ok(`Serviço "motocontrol" registrado no systemd (usuário ${user}) e iniciado`);
  // Garante que o PostgreSQL também inicia com o sistema.
  run('systemctl', ['enable', 'postgresql']);
  if (which('ufw') && /Status: active/.test(run('ufw', ['status']).stdout || '')) {
    run('ufw', ['allow', `${PORT}/tcp`]);
    ok(`Porta ${PORT} liberada no firewall (ufw)`);
  }
  return true;
}

function setupServiceWindows() {
  const launcher = path.join(ROOT, 'iniciar-motocontrol.bat');
  fs.writeFileSync(launcher, [
    '@echo off',
    'rem Gerado pelo instalador. Inicia o MotoControl (usado pelo Agendador de Tarefas).',
    `cd /d "${ROOT}"`,
    `"${process.execPath}" app.js >> "${path.join(ROOT, 'motocontrol.log')}" 2>&1`,
    '',
  ].join('\r\n'));
  // Tarefa agendada na inicialização do Windows, mesmo sem ninguém logado, reiniciando em caso de falha.
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>MotoControl - servidor da oficina</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>"${launcher}"</Command><WorkingDirectory>${ROOT}</WorkingDirectory></Exec></Actions>
</Task>`;
  const xmlFile = path.join(os.tmpdir(), 'motocontrol-task.xml');
  fs.writeFileSync(xmlFile, `﻿${xml}`, 'utf16le');
  run('schtasks', ['/End', '/TN', 'MotoControl'], { stdio: 'ignore' });
  let r = run('schtasks', ['/Create', '/F', '/TN', 'MotoControl', '/XML', xmlFile]);
  fs.unlinkSync(xmlFile);
  if (r.status !== 0) { warn(`Não foi possível criar a tarefa agendada: ${(r.stderr || r.stdout).trim()}`); return false; }
  r = run('schtasks', ['/Run', '/TN', 'MotoControl']);
  if (r.status !== 0) { warn('Tarefa criada, mas não foi possível iniciá-la agora.'); return false; }
  ok('Tarefa "MotoControl" criada no Agendador de Tarefas (inicia com o Windows) e iniciada');

  run('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=MotoControl'], { stdio: 'ignore' });
  r = run('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=MotoControl', 'dir=in', 'action=allow',
    'protocol=TCP', `localport=${PORT}`, 'remoteip=localsubnet', 'profile=any']);
  if (r.status === 0) ok(`Porta ${PORT} liberada no Firewall do Windows (somente rede local)`);
  else warn('Não foi possível liberar a porta no firewall.');
  return true;
}

/** Atalhos no Windows: área de trabalho e menu Iniciar (para todos os usuários). */
function createWindowsShortcuts() {
  const ps = (s) => s.replace(/'/g, "''");
  const icon = path.join(ROOT, 'client', 'favicon.ico');
  const shortcuts = [
    ['[Environment]::GetFolderPath("CommonDesktopDirectory")', 'MotoControl', 'iniciar.bat', 'Abrir o MotoControl'],
    ['Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "MotoControl"', 'MotoControl', 'iniciar.bat', 'Abrir o MotoControl'],
    ['Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "MotoControl"', 'Parar MotoControl', 'parar.bat', 'Parar o servidor do MotoControl'],
  ];
  const script = ['$ws = New-Object -ComObject WScript.Shell'];
  for (const [dirExpr, name, target, desc] of shortcuts) {
    script.push(
      `$d = ${dirExpr}; New-Item -ItemType Directory -Force -Path $d | Out-Null`,
      `$s = $ws.CreateShortcut((Join-Path $d '${ps(name)}.lnk'))`,
      `$s.TargetPath = '${ps(path.join(ROOT, target))}'; $s.WorkingDirectory = '${ps(ROOT)}'`,
      `$s.IconLocation = '${ps(icon)},0'; $s.Description = '${ps(desc)}'; $s.WindowStyle = 7; $s.Save()`,
    );
  }
  const r = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script.join('; ')]);
  if (r.status === 0) ok('Atalhos "MotoControl" criados na área de trabalho e no menu Iniciar');
  else warn(`Não foi possível criar os atalhos: ${(r.stderr || '').trim().split('\n')[0]}`);
}

/** Arquivo .url com o endereço na rede, para copiar para a área de trabalho dos outros computadores. */
function createClientShortcut(port) {
  const ip = lanAddresses()[0];
  if (!ip) return null;
  const file = path.join(ROOT, 'MotoControl (outros computadores).url');
  fs.writeFileSync(file, ['[InternetShortcut]', `URL=http://${ip}:${port}/`, ''].join('\r\n'));
  return file;
}

async function setupService(answers) {
  step(7, 'Configurando inicialização automática e atalhos');
  if (IS_WIN && isAdmin() && !flag('no-shortcuts')) createWindowsShortcuts();
  if (flag('no-service')) { info('Inicialização automática ignorada (--no-service).'); return false; }
  if (!isAdmin()) {
    warn(IS_WIN ? 'Execute instalar.bat como administrador para esta etapa.' : 'Execute com sudo para esta etapa.');
    return false;
  }
  const started = IS_WIN ? setupServiceWindows() : setupServiceLinux();
  if (started && answers.disableSleep) {
    if (IS_WIN) {
      run('powercfg', ['/change', 'standby-timeout-ac', '0']);
      run('powercfg', ['/change', 'hibernate-timeout-ac', '0']);
      ok('Suspensão desativada (na tomada)');
    } else {
      run('systemctl', ['mask', 'sleep.target', 'suspend.target', 'hibernate.target', 'hybrid-sleep.target']);
      ok('Suspensão desativada');
    }
  }
  return started;
}

async function waitForHealth(port, timeoutMs = 30000) {
  const http = require('http');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const okResp = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (okResp) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function finish(serviceStarted, env, generatedAdminPassword, pgInstall) {
  step(8, 'Verificando');
  const port = Number(env.PORT) || PORT;
  if (serviceStarted) {
    if (await waitForHealth(port)) ok('MotoControl respondendo');
    else warn(`O serviço não respondeu. Veja o log: ${IS_WIN ? path.join(ROOT, 'motocontrol.log') : 'journalctl -u motocontrol -n 50'}`);
  } else {
    info(`Para iniciar: ${color('1', IS_WIN ? 'iniciar.bat' : './iniciar.sh')} (na pasta ${ROOT})`);
  }
  const clientShortcut = createClientShortcut(port);
  const ips = lanAddresses();
  console.log(`\n${color('1;32', '══ Instalação concluída ══')}\n`);
  console.log('  Neste computador:   ' + color('1', `http://localhost:${port}`));
  if (ips.length) {
    console.log('  Nos outros:         ' + ips.map((ip) => color('1', `http://${ip}:${port}`)).join('  ou  '));
    console.log(color('2', '  (Reserve um IP fixo para este computador no roteador para o endereço não mudar.)'));
  }
  if (clientShortcut) {
    console.log(`\n  Atalho para os outros computadores: copie ${color('1', `"${path.basename(clientShortcut)}"`)}`);
    console.log('  (está na pasta do sistema) para a área de trabalho de cada um.');
  }
  console.log(`  Para abrir/parar o sistema neste computador: ${IS_WIN ? 'atalho "MotoControl" na área de trabalho / parar.bat' : './iniciar.sh / sudo ./parar.sh'}`);
  console.log(`\n  Usuário: ${color('1', 'admin')}`);
  if (generatedAdminPassword) {
    console.log(`  Senha provisória: ${color('1;33', generatedAdminPassword)}  (será pedida a troca no primeiro acesso)`);
  }
  if (pgInstall) {
    console.log(`\n  Banco de dados (PostgreSQL), usuário ${color('1', 'postgres')}:`);
    if (pgInstall.generated) {
      console.log(`  Senha: ${color('1;33', pgInstall.password)}  (também salva em ${path.basename(PG_PASSWORD_FILE)} — guarde em local seguro e apague o arquivo)`);
    } else {
      console.log('  Senha: a que você definiu durante a instalação. Guarde-a junto com a senha do admin.');
    }
  }
  console.log('\n  Próximos passos: entre como admin, cadastre os funcionários em "Funcionários" e');
  console.log('  copie periodicamente a pasta "backups" para um pendrive ou HD externo.\n');
}

// ---------------------------------------------------------------- principal
(async () => {
  console.log(color('1', '\n  MotoControl — instalação do servidor da oficina\n'));
  const { pgBin: foundPgBin, pgMissing } = checkPrerequisites();
  installDeps();
  const existingEnv = readEnvFile();
  const answers = await collectAnswers(existingEnv, pgMissing);
  if (rl) { rl.close(); rl = null; } // nenhuma pergunta daqui em diante
  const { databaseUrl, pgBin: installedPgBin } = await setupDatabase(existingEnv, pgMissing, answers);
  const env = writeEnv(existingEnv, databaseUrl, installedPgBin || foundPgBin);
  const generated = await setupSchemaAndAdmin(env, answers);
  const started = await setupService(answers);
  const pgInstall = pgMissing ? { password: answers.pgPassword, generated: answers.pgGenerated } : null;
  await finish(started, env, generated, pgInstall);
  if (rl) rl.close();
})().catch((err) => {
  if (rl) rl.close();
  fail(err.message);
});
