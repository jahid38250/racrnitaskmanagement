import 'dotenv/config';
import { ensureMysqlSchema, checkMysqlDbHealth, getMysqlConfig } from '../mysqlDb.ts';

async function main() {
  const cfg = getMysqlConfig();
  if (!cfg.enabled) {
    console.error('MYSQL_HOST is not set. Please configure MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD in .env.');
    process.exit(1);
  }

  console.log(`Initializing MySQL schema on ${cfg.host}:${cfg.port}/${cfg.database}...`);
  const ok = await ensureMysqlSchema(true);
  if (!ok) {
    console.error('Failed to initialize MySQL schema.');
    process.exit(1);
  }

  const health = await checkMysqlDbHealth();
  console.log('Database health check:', health);
  if (!health.ok) {
    process.exit(1);
  }
  console.log('MySQL database schema initialized successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected initialization error:', err);
  process.exit(1);
});
