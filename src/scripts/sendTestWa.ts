import 'dotenv/config';
import { buildWhatsAppLink, buildWhatsAppMessage } from '../services/whatsappNotification';

async function main() {
  const phone = process.env.TEST_WA_PHONE || process.argv[2] || '628211032375';

  const message = buildWhatsAppMessage({
    title: 'Alert Kontrak (Reminder H-30)',
    heading: 'Reminder H-30',
    message:
      'Kontrak Budi Santoso (PKWT/2026/TECH/001) akan berakhir dalam 30 hari pada 2026-09-07. Mohon persiapkan perpanjangan kontrak.',
    contract: {
      employee: { name: 'Budi Santoso' },
      contractNumber: 'PKWT/2026/TECH/001',
      endDate: '2026-09-07',
    },
  });

  const link = buildWhatsAppLink(phone, message);

  console.log('[Test WA] Target nomor:', phone);
  console.log('');
  console.log('--- Pesan yang akan dikirim ---');
  console.log(message);
  console.log('');
  console.log('--- Link wa.me (buka untuk mengirim) ---');
  console.log(link);
  console.log('');

  if (!link) {
    console.error('[Test WA] Nomor telepon tidak valid.');
    process.exit(1);
  }
}

main();
