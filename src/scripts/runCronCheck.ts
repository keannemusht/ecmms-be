import 'dotenv/config';
import prisma from '../prisma';
import { runContractExpirationCheck } from '../services/cronService';

async function main() {
  console.log('[Test Cron] Running contract expiration check now...');
  const summary = await runContractExpirationCheck();
  console.log('[Test Cron] Done. Summary:', JSON.stringify(summary, null, 2));
  console.log('[Test Cron] Check NotificationLog (or Notifications -> Log Pengiriman in the UI) for results.');
}

main()
  .catch((e) => {
    console.error('[Test Cron] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
