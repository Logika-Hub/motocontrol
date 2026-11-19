/* Gera um backup manual: npm run backup */
const { createBackup } = require('../server/services/backup');

createBackup()
  .then((b) => console.log(`Backup gerado: ${b.file} (${b.size} bytes)`))
  .catch((err) => { console.error('Falha no backup:', err.message); process.exit(1); });
