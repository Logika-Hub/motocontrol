#!/usr/bin/env node
/*
 * Gera o pacote de instalação do MotoControl para levar à oficina (pendrive), com tudo
 * o que é preciso para instalar SEM internet no Windows:
 *
 *   dist/MotoControl-<versão>/
 *     instalar.bat, iniciar.bat, parar.bat ...   arquivos do sistema
 *     node_modules/                               dependências já instaladas
 *     instaladores/node-vXX-x64.msi               Node.js LTS (verificado por SHA-256)
 *     instaladores/postgresql-XX-windows-x64.exe  PostgreSQL
 *     LEIA-ME.txt
 *
 * Uso (no seu computador, com internet):  npm run pacote
 *
 * Os instaladores ficam guardados em ./instaladores (fora do Git) e são reaproveitados nas
 * próximas gerações. Se o download do PostgreSQL falhar, baixe manualmente o instalador para
 * Windows x86-64 em https://www.enterprisedb.com/downloads/postgres-postgresql-downloads e
 * coloque-o em ./instaladores — o script usa o que encontrar lá.
 *
 * Variáveis opcionais:
 *   NODE_MAJOR=24                 major do Node.js (padrão: LTS mais recente)
 *   PG_INSTALLER_URL=https://...  URL do instalador do PostgreSQL
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'instaladores');
const IS_WIN = process.platform === 'win32';
// Atualize quando sair uma nova versão (lista em https://www.enterprisedb.com/downloads/postgres-postgresql-downloads).
const PG_DEFAULT_URL = 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64.exe';

const log = (s) => console.log(s);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit', shell: IS_WIN, ...opts });

function get(url, { json = false, file = null, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'motocontrol-pacote' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), { json, file, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} em ${url}`)); }
      if (file) {
        const tmp = `${file}.parcial`;
        const out = fs.createWriteStream(tmp);
        const total = Number(res.headers['content-length']) || 0;
        let got = 0; let last = 0;
        res.on('data', (c) => {
          got += c.length;
          if (total && process.stdout.isTTY && Date.now() - last > 500) {
            last = Date.now();
            process.stdout.write(`\r    ${(got / 1048576).toFixed(0)} de ${(total / 1048576).toFixed(0)} MB`);
          }
        });
        res.pipe(out);
        out.on('finish', () => { if (process.stdout.isTTY) process.stdout.write('\n'); fs.renameSync(tmp, file); resolve(file); });
        out.on('error', reject);
        return undefined;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(json ? JSON.parse(body) : body));
      return undefined;
    }).on('error', reject);
  });
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const findCached = (re) => (fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => re.test(f)).sort().pop() : null);

async function nodeInstaller() {
  log('\n[Node.js]');
  const index = await get('https://nodejs.org/dist/index.json', { json: true });
  const major = process.env.NODE_MAJOR;
  const rel = index.find((r) => r.lts && (!major || r.version.startsWith(`v${major}.`)));
  if (!rel) throw new Error(`Nenhuma versão LTS encontrada${major ? ` para Node ${major}` : ''}.`);
  const name = `node-${rel.version}-x64.msi`;
  const file = path.join(CACHE, name);
  const sums = await get(`https://nodejs.org/dist/${rel.version}/SHASUMS256.txt`);
  const expected = (sums.split('\n').find((l) => l.endsWith(`  ${name}`)) || '').split(' ')[0];
  if (!expected) throw new Error(`Checksum de ${name} não encontrado.`);
  if (fs.existsSync(file) && sha256(file) === expected) {
    log(`  ${name} já baixado (${rel.lts})`);
  } else {
    log(`  Baixando ${name} (${rel.lts})...`);
    await get(`https://nodejs.org/dist/${rel.version}/${name}`, { file });
    if (sha256(file) !== expected) { fs.unlinkSync(file); throw new Error(`Checksum inválido em ${name} — download corrompido.`); }
  }
  log('  SHA-256 conferido com nodejs.org');
  // Remove versões antigas do cache.
  for (const f of fs.readdirSync(CACHE)) if (/^node-v.*-x64\.msi$/.test(f) && f !== name) fs.unlinkSync(path.join(CACHE, f));
  return name;
}

async function postgresInstaller() {
  log('\n[PostgreSQL]');
  const url = process.env.PG_INSTALLER_URL || PG_DEFAULT_URL;
  const name = path.basename(new URL(url).pathname);
  const cached = fs.existsSync(path.join(CACHE, name)) ? name : findCached(/^postgresql-.*-windows-x64\.exe$/i);
  if (cached) {
    log(`  ${cached} já presente em instaladores/`);
    return cached;
  }
  try {
    log(`  Baixando ${name}...`);
    await get(url, { file: path.join(CACHE, name) });
    log(`  SHA-256: ${sha256(path.join(CACHE, name))}`);
    return name;
  } catch (err) {
    log(`  ! Não foi possível baixar (${err.message}).`);
    log('    Baixe o instalador "Windows x86-64" em https://www.enterprisedb.com/downloads/postgres-postgresql-downloads');
    log(`    e salve-o em ${CACHE}; depois execute "npm run pacote" de novo.`);
    return null;
  }
}

// A oficina recebe o sistema e o manual; contexto, documentação técnica e testes ficam só no repositório.
const EXCLUDE = [/^tests\//, /^\.git/, /^docs\/contexto\//, /^docs\/tecnico\//, /^docs\/README\.md$/, /^CLAUDE\.md$/, /^README\.md$/];

function copyProject(dest) {
  const r = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Este script precisa ser executado dentro do repositório Git do MotoControl.');
  const files = r.stdout.split('\0').filter(Boolean)
    .filter((f) => !EXCLUDE.some((re) => re.test(f)));
  for (const f of files) {
    const target = path.join(dest, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), target);
  }
  // Arquivos .bat precisam de quebra de linha CRLF no Windows, independentemente de onde o pacote foi gerado.
  for (const f of files.filter((x) => x.endsWith('.bat'))) {
    const p = path.join(dest, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  return files.length;
}

function readme(version, nodeName, pgName) {
  return [
    `MotoControl ${version} — pacote de instalação`,
    '==============================================',
    '',
    'INSTALAÇÃO (no computador que será o servidor da oficina, Windows 10 ou 11)',
    '',
    '  1. Copie esta pasta inteira para o disco do computador, por exemplo C:\\MotoControl',
    '     (não execute direto do pendrive: o sistema roda a partir desta pasta).',
    '  2. Clique com o botão direito em "instalar.bat" e escolha "Executar como administrador".',
    '  3. Logo no começo, o instalador pede todas as senhas de uma vez:',
    '     - a senha do BANCO DE DADOS: ANOTE-A em local seguro (não fica salva no computador;',
    '       é necessária para reinstalar ou dar manutenção);',
    '     - a senha do usuário "admin" do MotoControl.',
    '     Depois disso a instalação segue sozinha até o fim (pode levar alguns minutos).',
    '  4. Ao final, o instalador mostra o endereço para acessar dos outros computadores.',
    '',
    'Não é preciso internet: os instaladores abaixo estão na pasta "instaladores":',
    `  - ${nodeName || '(Node.js não incluído)'}`,
    `  - ${pgName || '(PostgreSQL não incluído — será baixado pelo winget, se houver internet)'}`,
    '',
    'MANUAL',
    '',
    '  Com o sistema aberto, clique em "Ajuda" (canto superior direito). O mesmo manual',
    '  está na pasta docs\\manual.',
    '',
    'USO NO DIA A DIA',
    '',
    '  - O sistema inicia sozinho quando o computador é ligado.',
    '  - Atalho "MotoControl" na área de trabalho: abre o sistema (e o inicia, se estiver parado).',
    '  - parar.bat: para o servidor (por exemplo, antes de restaurar um backup).',
    '  - Nos outros computadores: copie o arquivo "MotoControl (outros computadores).url",',
    '    criado nesta pasta pelo instalador, para a área de trabalho de cada um.',
    '',
    'BACKUP',
    '',
    '  Cópias automáticas diárias ficam na pasta "backups". Copie essa pasta regularmente',
    '  para um pendrive ou HD externo.',
    '',
  ].join('\r\n');
}

(async () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dest = path.join(ROOT, 'dist', `MotoControl-${version}`);
  fs.mkdirSync(CACHE, { recursive: true });

  log(`Gerando pacote do MotoControl ${version}`);
  let nodeName = null; let pgName = null;
  try { nodeName = await nodeInstaller(); } catch (err) { log(`  ! ${err.message}`); }
  pgName = await postgresInstaller();

  log('\n[Sistema]');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  log(`  ${copyProject(dest)} arquivos copiados`);
  log('  Instalando dependências de produção...');
  const npm = run(IS_WIN ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dest });
  if (npm.status !== 0) throw new Error('npm ci falhou.');

  fs.mkdirSync(path.join(dest, 'instaladores'), { recursive: true });
  for (const f of [nodeName, pgName].filter(Boolean)) fs.copyFileSync(path.join(CACHE, f), path.join(dest, 'instaladores', f));
  fs.writeFileSync(path.join(dest, 'LEIA-ME.txt'), `\ufeff${readme(version, nodeName, pgName)}`);

  // Compacta em .zip (tar do Windows 10+ ou zip do Linux), se disponível.
  const zip = `${dest}.zip`;
  fs.rmSync(zip, { force: true });
  const base = path.basename(dest);
  const z = IS_WIN
    ? spawnSync('tar', ['-a', '-c', '-f', zip, base], { cwd: path.dirname(dest) })
    : spawnSync('zip', ['-qr', zip, base], { cwd: path.dirname(dest) });

  log('\nPacote pronto:');
  log(`  pasta: ${dest}`);
  if (z.status === 0 && fs.existsSync(zip)) log(`  zip:   ${zip} (${(fs.statSync(zip).size / 1048576).toFixed(0)} MB)`);
  if (!nodeName || !pgName) {
    log('\n  ATENÇÃO: faltam instaladores (veja as mensagens acima). Sem eles, a instalação');
    log('  na oficina precisará de internet para baixar o que faltar.');
    process.exitCode = 2;
  }
})().catch((err) => {
  console.error(`\nErro: ${err.message}`);
  process.exit(1);
});
