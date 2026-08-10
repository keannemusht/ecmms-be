"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runContractExpirationCheck = runContractExpirationCheck;
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../prisma"));
const notificationDelivery_1 = require("./notificationDelivery");
function formatDate(d) {
    return d.toISOString().split('T')[0];
}
function buildEmailContext(params) {
    return {
        appName: 'ECMMS',
        appTagline: 'Sistem Management & Monitoring PKWT',
        title: params.title,
        heading: params.heading,
        message: params.message,
        details: [
            { label: 'Karyawan', value: params.contract.employee.name },
            { label: 'No. Kontrak', value: params.contract.contractNumber },
            { label: 'Tanggal Berakhir', value: formatDate(new Date(params.contract.endDate)) },
        ],
        footerText: params.footerText,
    };
}
function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}
async function resolveRecipients(targetRole, employee) {
    if (targetRole === 'USER') {
        const userIds = employee?.user ? [employee.user.id] : [];
        const email = employee?.user?.email || employee?.email || '';
        return { userIds, emails: email ? [email] : [] };
    }
    const users = await prisma_1.default.user.findMany({
        where: { role: { in: ['ADMIN', 'MANAGEMENT'] } },
        include: { employee: true },
    });
    return {
        userIds: users.map((u) => u.id),
        emails: [...new Set(users.map((u) => u.email).filter((e) => Boolean(e)))],
    };
}
async function sendInApp(userIds, title, message, link = '/contracts') {
    for (const userId of userIds) {
        await prisma_1.default.inAppNotification.create({
            data: { userId, title, message, link },
        });
    }
}
async function logNotification(params) {
    await prisma_1.default.notificationLog.create({
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
async function dispatchRule(contract, rule, message) {
    const title = `Alert Kontrak (${rule.name})`;
    const allUserIds = new Set();
    for (const targetRole of rule.targetRoles) {
        const recipients = await resolveRecipients(targetRole, contract.employee);
        for (const userId of recipients.userIds) {
            allUserIds.add(userId);
        }
        for (const channel of rule.channels) {
            if (channel === 'IN_APP') {
                continue; // In-app is always mirrored below.
            }
            if (channel === 'EMAIL') {
                for (const email of recipients.emails) {
                    const result = await (0, notificationDelivery_1.sendEmail)(email, title, {
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
async function runEscalation(contract) {
    const today = startOfToday();
    const alreadySent = await prisma_1.default.notificationLog.findFirst({
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
        const result = await (0, notificationDelivery_1.sendEmail)(email, 'Eskalasi Kontrak - Perlu Tindak Lanjut', {
            template: 'notification',
            context: buildEmailContext({
                title: 'Eskalasi Kontrak',
                heading: 'Kontrak telah melewati tanggal berakhir',
                message,
                contract,
                footerText: 'Segera lakukan tindak lanjut terhadap kontrak yang sudah jatuh tempo.',
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
async function runContractExpirationCheck() {
    console.log('[Cron] Running daily contract expiration and notification check...');
    try {
        const today = startOfToday();
        // 1. Fetch active rules
        const rules = await prisma_1.default.notificationRule.findMany({
            where: { isActive: true },
        });
        // 2. Fetch non-permanent contracts that are not yet extended
        const contracts = await prisma_1.default.contract.findMany({
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
                await prisma_1.default.contract.update({
                    where: { id: contract.id },
                    data: { status: 'EXPIRED' },
                });
            }
            else if (diffDays > 0 && diffDays <= 30 && contract.status === 'AKTIF') {
                await prisma_1.default.contract.update({
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
    }
    catch (error) {
        console.error('[Cron Error] Failed to run contract expiration check:', error);
    }
}
function initCronJobs() {
    // Run once daily at 01:00 AM
    node_cron_1.default.schedule('0 1 * * *', () => {
        runContractExpirationCheck();
    });
    // Run initial check on server startup
    setTimeout(() => {
        runContractExpirationCheck();
    }, 5000);
    console.log('[Cron] Contract monitoring cron scheduler initialized.');
}
