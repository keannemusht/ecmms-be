import cron from 'node-cron';
import prisma from '../prisma';
import { sendEmail, getEmailLogoUrl } from './notificationDelivery';
import { buildWhatsAppMessage } from './whatsappNotification';
import { NotificationChannel, Role } from '@prisma/client';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildEmailContext(params: {
  title: string;
  heading: string;
  message: string;
  footerText: string;
  contract: any;
  titleEn?: string;
  headingEn?: string;
  footerTextEn?: string;
}) {
  const employeeName = params.contract.employee.name;
  const contractNumber = params.contract.contractNumber;
  const endDate = formatDate(new Date(params.contract.endDate));

  const enMessage = `Contract ${employeeName} (${contractNumber}) will expire on ${endDate}. Please review and follow up as needed.`;

  return {
    appName: 'ECMMS',
    appTagline: 'Employee Contract Management & Monitoring System',
    logoUrl: getEmailLogoUrl(),
    en: {
      title: params.titleEn || 'Contract Alert',
      heading: params.headingEn || params.heading,
      message: enMessage,
      details: [
        { label: 'Employee', value: employeeName },
        { label: 'Contract No.', value: contractNumber },
        { label: 'End Date', value: endDate },
      ],
      footerText:
        params.footerTextEn || 'This message was sent automatically by the PKWT contract monitoring system.',
    },
    id: {
      title: params.title,
      heading: params.heading,
      message: params.message,
      details: [
        { label: 'Karyawan', value: employeeName },
        { label: 'No. Kontrak', value: contractNumber },
        { label: 'Tanggal Berakhir', value: endDate },
      ],
      footerText: params.footerText,
    },
  };
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

interface Recipients {
  userIds: string[];
  emails: string[];
  phones: string[];
}

async function resolveRecipients(targetRole: Role, employee: any): Promise<Recipients> {
  if (targetRole === 'USER') {
    const userIds = employee?.user ? [employee.user.id] : [];
    const email = employee?.user?.email || employee?.email || '';
    const phones = employee?.phone ? [employee.phone] : [];
    return { userIds, emails: email ? [email] : [], phones };
  }

  const users = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'MANAGEMENT'] } },
    include: { employee: true },
  });

  return {
    userIds: users.map((u) => u.id),
    emails: [...new Set(users.map((u) => u.email).filter((e): e is string => Boolean(e)))],
    phones: [...new Set(users.map((u) => u.employee?.phone).filter((p): p is string => Boolean(p)))],
  };
}

async function sendInApp(userIds: string[], title: string, message: string, link = '/contracts') {
  for (const userId of userIds) {
    await prisma.inAppNotification.create({
      data: { userId, title, message, link },
    });
  }
}

async function sendWhatsAppActionNotifications(params: {
  contractId: string;
  title: string;
  message: string;
  phone: string;
  waMessage: string;
}) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'MANAGEMENT'] }, isActive: true },
    select: { id: true },
  });

  for (const admin of admins) {
    await prisma.inAppNotification.create({
      data: {
        userId: admin.id,
        title: `WhatsApp · ${params.title}`,
        message: params.message,
        contractId: params.contractId,
        whatsappPhone: params.phone,
        whatsappMessage: params.waMessage,
      },
    });
  }
}

async function logNotification(params: {
  contractId: string;
  recipient: string;
  channel: NotificationChannel;
  status: string;
  message: string;
  error?: string;
}) {
  await prisma.notificationLog.create({
    data: {
      contractId: params.contractId,
      recipient: params.recipient,
      channel: params.channel,
      status: params.status,
      message: params.message,
      error: params.error,
    },
  });
}

async function dispatchRule(contract: any, rule: any, message: string) {
  const title = `Alert Kontrak (${rule.name})`;
  const allUserIds = new Set<string>();

  for (const targetRole of rule.targetRoles) {
    const recipients = await resolveRecipients(targetRole as Role, contract.employee);

    for (const userId of recipients.userIds) {
      allUserIds.add(userId);
    }

    for (const channel of rule.channels) {
      if (channel === 'IN_APP') {
        continue; // In-app is always mirrored below.
      }

      if (channel === 'EMAIL') {
        for (const email of recipients.emails) {
          const result = await sendEmail(email, title, {
            template: 'notification',
            context: buildEmailContext({
              title,
              heading: rule.name,
              message,
              contract,
              footerText: 'Pesan ini dikirim otomatis oleh sistem monitoring kontrak PKWT.',
            }),
          });
          await logNotification({
            contractId: contract.id,
            recipient: email,
            channel: 'EMAIL',
            status: result.ok ? 'SENT' : 'FAILED',
            message,
            error: result.error,
          });
        }
      } else if (channel === 'WHATSAPP') {
        for (const phone of recipients.phones) {
          const waMessage = buildWhatsAppMessage({
            title,
            heading: rule.name,
            message,
            contract,
            footerText: 'Pesan ini dikirim otomatis oleh sistem monitoring kontrak PKWT.',
          });
          await sendWhatsAppActionNotifications({
            contractId: contract.id,
            title,
            message,
            phone,
            waMessage,
          });
        }
      }
    }
  }

  // Always mirror to in-app so everyone sees it inside the system.
  const userIds = [...allUserIds];
  if (userIds.length > 0) {
    await sendInApp(userIds, title, message);
  }
  for (const userId of userIds) {
    await logNotification({ contractId: contract.id, recipient: userId, channel: 'IN_APP', status: 'SENT', message });
  }
}

async function runEscalation(contract: any) {
  const today = startOfToday();

  const alreadySent = await prisma.notificationLog.findFirst({
    where: {
      contractId: contract.id,
      message: { startsWith: 'Eskalasi:' },
      sentAt: { gte: today },
    },
  });

  if (alreadySent) {
    return;
  }

  const message = `Eskalasi: Kontrak ${contract.employee.name} (${contract.contractNumber}) telah melewati tanggal berakhir (${formatDate(new Date(contract.endDate))}) dan belum ada tindak lanjut.`;
  const recipients = await resolveRecipients('MANAGEMENT', contract.employee);

  await sendInApp(recipients.userIds, 'Eskalasi Kontrak', message);

  await logNotification({
    contractId: contract.id,
    recipient: recipients.userIds.join(','),
    channel: 'IN_APP',
    status: 'SENT',
    message,
  });

  for (const email of recipients.emails) {
    const result = await sendEmail(email, 'Eskalasi Kontrak - Perlu Tindak Lanjut', {
      template: 'notification',
      context: buildEmailContext({
        title: 'Eskalasi Kontrak',
        heading: 'Kontrak telah melewati tanggal berakhir',
        message,
        contract,
        footerText: 'Segera lakukan tindak lanjut terhadap kontrak yang sudah jatuh tempo.',
        titleEn: 'Contract Escalation',
        headingEn: 'Contract has passed its end date',
        footerTextEn: 'Please follow up on contracts that have passed their end date.',
      }),
    });
    await logNotification({
      contractId: contract.id,
      recipient: email,
      channel: 'EMAIL',
      status: result.ok ? 'SENT' : 'FAILED',
      message,
      error: result.error,
    });
  }

  console.log(`[Cron Escalation] Escalated for ${contract.employee.name} (${contract.contractNumber})`);
}

export async function runContractExpirationCheck() {
  console.log('[Cron] Running daily contract expiration and notification check...');

  try {
    const today = startOfToday();

    // 1. Fetch active rules
    const rules = await prisma.notificationRule.findMany({
      where: { isActive: true },
    });

    // 2. Fetch non-permanent contracts that are not yet extended
    const contracts = await prisma.contract.findMany({
      where: {
        status: { notIn: ['DIPERPANJANG', 'DIANGKAT_TETAP'] },
      },
      include: {
        employee: {
          include: { user: true },
        },
      },
    });

    for (const contract of contracts) {
      const endDate = new Date(contract.endDate);
      endDate.setHours(0, 0, 0, 0);

      const diffTime = endDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));

      // Auto update status
      if (diffDays <= 0 && contract.status !== 'EXPIRED') {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'EXPIRED' },
        });
      } else if (diffDays > 0 && diffDays <= 30 && contract.status === 'AKTIF') {
        await prisma.contract.update({
          where: { id: contract.id },
          data: { status: 'AKAN_BERAKHIR' },
        });
      }

      // Check matching rules
      for (const rule of rules) {
        if (rule.daysBefore === diffDays) {
          const message = rule.template
            .replace('{{employeeName}}', contract.employee.name)
            .replace('{{contractNumber}}', contract.contractNumber)
            .replace('{{endDate}}', formatDate(endDate));

          await dispatchRule(contract, rule, message);

          console.log(`[Cron Alert] ${rule.channels.join('+')} dispatched for ${contract.employee.name} (${rule.name})`);
        }
      }

      // Escalation for overdue contracts with no follow-up (H+1 rule)
      if (diffDays <= 0 && contract.status === 'EXPIRED') {
        await runEscalation(contract);
      }
    }
  } catch (error) {
    console.error('[Cron Error] Failed to run contract expiration check:', error);
  }
}

export function initCronJobs() {
  // Run once daily at 01:00 AM
  cron.schedule('0 1 * * *', () => {
    runContractExpirationCheck();
  });

  // Run initial check on server startup
  setTimeout(() => {
    runContractExpirationCheck();
  }, 5000);

  console.log('[Cron] Contract monitoring cron scheduler initialized.');
}
