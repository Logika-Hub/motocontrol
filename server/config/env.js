require('dotenv').config({ quiet: true });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://motocontrol:motocontrol@localhost:5432/motocontrol',
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionMaxAgeHours: Number(process.env.SESSION_MAX_AGE_HOURS) || 12,
  backupDir: process.env.BACKUP_DIR || './backups',
  backupIntervalHours: Number(process.env.BACKUP_INTERVAL_HOURS ?? 24),
  backupKeep: Number(process.env.BACKUP_KEEP) || 30,
};

if (!env.sessionSecret) {
  if (env.nodeEnv === 'production') {
    throw new Error('SESSION_SECRET é obrigatório em produção. Defina-o no arquivo .env.');
  }
  env.sessionSecret = 'dev-secret-nao-usar-em-producao';
}

module.exports = env;
