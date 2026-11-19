/*
 * Restaura um backup, SUBSTITUINDO os dados atuais.
 *   npm run restore -- motocontrol-20261119-183000.dump
 *   npm run restore -- --list
 * Pare o servidor antes de restaurar.
 */
const readline = require('readline');
const { restoreBackup, listBackups, createBackup } = require('../server/services/backup');

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--list') {
    const list = listBackups();
    if (!list.length) return console.log('Nenhum backup encontrado.');
    list.forEach((b) => console.log(`${b.file}  ${(b.size / 1024).toFixed(1)} KB`));
    if (!arg) console.log('\nUso: npm run restore -- <arquivo.dump>');
    return;
  }
  if (!process.argv.includes('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((r) => rl.question(`Os dados atuais serão substituídos por ${arg}. Digite RESTAURAR para confirmar: `, r));
    rl.close();
    if (answer.trim() !== 'RESTAURAR') return console.log('Cancelado.');
  }
  const safety = await createBackup();
  console.log(`Backup de segurança do estado atual: ${safety.file}`);
  const file = await restoreBackup(arg);
  console.log(`Restaurado a partir de ${file}.`);
}

main().catch((err) => { console.error('Falha na restauração:', err.message); process.exit(1); });
