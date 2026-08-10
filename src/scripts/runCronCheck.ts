import 'dotenv/config';
import prisma from '../prisma';
import { runContractExpirationCheck } from '../services/cronService';

async function main() {
  console.log('[Test Cron] Running contract expiration check now...');
  await runContractExpirationCheck();
  console.log('[Test Cron] Done. Check NotificationLog (or Notifications -> Log Pengiriman in the UI) for results.');
}

main()
  .catch((e) => {
    console.error('[Test Cron] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
