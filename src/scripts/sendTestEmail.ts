import 'dotenv/config';
import { sendEmail } from '../services/notificationDelivery';

const RECIPIENT = process.env.TEST_EMAIL || process.argv[2] || 'kemal.musthafa@bataramining.com';

async function main() {
  console.log(`[Test Email] Sending to: ${RECIPIENT}`);
  console.log(`[Test Email] Sender config: SMTP_HOST=${process.env.SMTP_HOST || '(gmail fallback)'} SMTP_USER=${process.env.SMTP_USER || process.env.MAIL_USER || '(none)'}`);

  const result = await sendEmail(RECIPIENT, 'ECMMS - Test Email Notification', {
    template: 'notification',
    context: {
      appName: 'ECMMS',
      appTagline: 'Sistem Management & Monitoring PKWT',
      title: 'Test Notification',
      heading: 'Email notification berhasil terkirim',
      message:
        'Ini adalah email uji coba dari sistem ECMMS. Jika Anda menerima email ini, berarti konfigurasi nodemailer dan template sudah berjalan dengan benar.',
      details: [
        { label: 'Karyawan', value: 'Budi Santoso (Contoh)' },
        { label: 'No. Kontrak', value: 'PKWT/2026/TECH/001' },
        { label: 'Tanggal Berakhir', value: '2026-09-07' },
      ],
      footerText: 'Pesan ini dikirim otomatis oleh sistem monitoring kontrak PKWT.',
    },
  });

  if (result.ok) {
    console.log('[Test Email] SUCCESS: Email terkirim.');
    process.exit(0);
  } else {
    console.error(`[Test Email] FAILED: ${result.error}`);
    process.exit(1);
  }
}

main();
