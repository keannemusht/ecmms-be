"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSystemNotificationsForUser = syncSystemNotificationsForUser;
exports.runContractExpirationCheck = runContractExpirationCheck;
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../prisma"));
const notificationDelivery_1 = require("./notificationDelivery");
const whatsappNotification_1 = require("./whatsappNotification");
const auditLogger_1 = require("../utils/auditLogger");
const contractNormalizer_1 = require("./contractNormalizer");
function formatDate(d) {
    return d.toISOString().split('T')[0];
}
function buildEmailContext(params) {
    const employeeName = params.contract.employee.name;
    const contractNumber = params.contract.contractNumber || '-';
    const endDate = formatDate(new Date(params.contract.endDate));
    const enMessage = `Contract ${employeeName}${params.contract.contractNumber ? ` (${params.contract.contractNumber})` : ''} will expire on ${endDate}. Please review and follow up as needed.`;
    return {
        appName: 'ECMMS',
        appTagline: 'Employee Contract Management & Monitoring System',
        subject: params.titleEn || params.title,
        logoUrl: (0, notificationDelivery_1.getEmailLogoUrl)(),
        en: {
            title: params.titleEn || 'Contract Alert',
            heading: params.headingEn || params.heading,
            message: enMessage,
            details: [
                { label: 'Employee', value: employeeName },
                { label: 'Contract No.', value: contractNumber },
                { label: 'End Date', value: endDate },
            ],
            footerText: params.footerTextEn || 'This message was sent automatically by the PKWT contract monitoring system.',
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
function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}
async function resolveRecipients(targetRole, employee) {
    if (targetRole === 'USER') {
        const userIds = employee?.user ? [employee.user.id] : [];
        const email = employee?.user?.email || employee?.email || '';
        const phones = employee?.phone ? [employee.phone] : [];
        return { userIds, emails: email ? [email] : [], phones };
    }
    // When targetRole is MANAGEMENT or ADMIN, include both roles so all overseers are notified
    const rolesToQuery = targetRole === 'MANAGEMENT' || targetRole === 'ADMIN'
        ? ['MANAGEMENT', 'ADMIN']
        : [targetRole];
    const users = await prisma_1.default.user.findMany({
        where: {
            role: { in: rolesToQuery },
            isActive: true,
        },
        include: { employee: true },
    });
    return {
        userIds: users.map((u) => u.id),
        emails: [...new Set(users.map((u) => u.email).filter((e) => Boolean(e)))],
        phones: [...new Set(users.map((u) => u.employee?.phone).filter((p) => Boolean(p)))],
    };
}
/**
 * Synchronizes system notifications (contract alerts, escalations) for an ADMIN or MANAGEMENT user
 * so that new or existing management users always have access to the system alerts.
 */
async function syncSystemNotificationsForUser(targetUserId, role) {
    if (role !== 'ADMIN' && role !== 'MANAGEMENT')
        return;
    try {
        const sourceUser = await prisma_1.default.user.findFirst({
            where: {
                id: { not: targetUserId },
                role: { in: ['ADMIN', 'MANAGEMENT'] },
                notifications: { some: {} },
            },
            select: { id: true },
        });
        if (!sourceUser)
            return;
        const existingNotifs = await prisma_1.default.inAppNotification.findMany({
            where: { userId: targetUserId },
            select: { title: true, message: true, contractId: true },
        });
        const existingKeys = new Set(existingNotifs.map((n) => `${n.title}|${n.message}|${n.contractId || ''}`));
        const sourceNotifs = await prisma_1.default.inAppNotification.findMany({
            where: { userId: sourceUser.id },
        });
        const toCreate = sourceNotifs
            .filter((n) => !existingKeys.has(`${n.title}|${n.message}|${n.contractId || ''}`))
            .map((n) => ({
            userId: targetUserId,
            title: n.title,
            message: n.message,
            link: n.link,
            contractId: n.contractId,
            whatsappPhone: n.whatsappPhone,
            whatsappMessage: n.whatsappMessage,
            isRead: false,
            createdAt: n.createdAt,
        }));
        if (toCreate.length > 0) {
            await prisma_1.default.inAppNotification.createMany({
                data: toCreate,
            });
            console.log(`[Notification Sync] Synced ${toCreate.length} notifications to user ${targetUserId} (${role})`);
        }
    }
    catch (err) {
        console.error('[Notification Sync] Failed to sync notifications for user:', err);
    }
}
async function sendInApp(userIds, title, message, link = '/contracts') {
    for (const userId of userIds) {
        await prisma_1.default.inAppNotification.create({
            data: { userId, title, message, link },
        });
    }
}
async function sendWhatsAppActionNotifications(params) {
    const admins = await prisma_1.default.user.findMany({
        where: { role: { in: ['ADMIN', 'MANAGEMENT'] }, isActive: true },
        select: { id: true },
    });
    for (const admin of admins) {
        await prisma_1.default.inAppNotification.create({
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
    let emailsSent = 0;
    let emailsFailed = 0;
    const today = startOfToday();
    const alreadySent = await prisma_1.default.notificationLog.findFirst({
        where: {
            contractId: contract.id,
            message,
            status: 'SENT',
            sentAt: { gte: today },
        },
    });
    if (alreadySent) {
        console.log(`[Cron Alert] Skipped duplicate dispatch for ${contract.employee.name} (${rule.name}) - already sent today`);
        return { emailsSent, emailsFailed };
    }
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
                    if (result.ok) {
                        emailsSent++;
                    }
                    else {
                        emailsFailed++;
                    }
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
            else if (channel === 'WHATSAPP') {
                for (const phone of recipients.phones) {
                    const waMessage = (0, whatsappNotification_1.buildWhatsAppMessage)({
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
    return { emailsSent, emailsFailed };
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
        return { escalated: false, emailsSent: 0, emailsFailed: 0 };
    }
    let emailsSent = 0;
    let emailsFailed = 0;
    const message = `Eskalasi: Kontrak ${contract.employee.name}${contract.contractNumber ? ` (${contract.contractNumber})` : ''} telah melewati tanggal berakhir (${formatDate(new Date(contract.endDate))}) dan belum ada tindak lanjut.`;
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
                titleEn: 'Contract Escalation',
                headingEn: 'Contract has passed its end date',
                footerTextEn: 'Please follow up on contracts that have passed their end date.',
            }),
        });
        if (result.ok) {
            emailsSent++;
        }
        else {
            emailsFailed++;
        }
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
    return { escalated: true, emailsSent, emailsFailed };
}
async function runContractExpirationCheck() {
    const summary = {
        contractsChecked: 0,
        rulesDispatched: 0,
        escalations: 0,
        emailsSent: 0,
        emailsFailed: 0,
        errors: [],
    };
    console.log('[Cron] Running daily contract expiration and notification check...');
    try {
        const today = startOfToday();
        // 0. Normalize contract statuses across all employees first
        // (ensures superseded older contracts are marked DIPERPANJANG and only latest contracts are evaluated)
        await (0, contractNormalizer_1.normalizeEmployeeContractStatuses)();
        // 1. Fetch active rules
        const rules = await prisma_1.default.notificationRule.findMany({
            where: { isActive: true },
        });
        // 2. Fetch non-permanent contracts that are not yet extended or resigned
        const contracts = await prisma_1.default.contract.findMany({
            where: {
                status: { notIn: ['DIPERPANJANG', 'RESIGN'] },
                contractType: { not: 'PKWTT' },
            },
            include: {
                employee: {
                    include: { user: true },
                },
            },
        });
        for (const contract of contracts) {
            summary.contractsChecked++;
            try {
                const endDate = new Date(contract.endDate);
                endDate.setHours(0, 0, 0, 0);
                const diffTime = endDate.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
                // A contract is only evaluated for expiration/alert if it is the employee's latest contract.
                // Historical contracts (hasSuccessor > 0) remain AKTIF as contract history and are skipped.
                const hasSuccessor = await prisma_1.default.contract.count({
                    where: { employeeId: contract.employeeId, sequence: { gt: contract.sequence } },
                });
                if (hasSuccessor > 0) {
                    if (contract.status !== 'RESIGN' && contract.status !== 'AKTIF') {
                        await prisma_1.default.contract.update({
                            where: { id: contract.id },
                            data: { status: 'AKTIF' },
                        });
                    }
                    continue;
                }
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
                // Check matching rules (triggers when contract enters the rule threshold window)
                for (const rule of rules) {
                    if (diffDays <= rule.daysBefore && diffDays > 0) {
                        const ruleAlreadySent = await prisma_1.default.notificationLog.findFirst({
                            where: {
                                contractId: contract.id,
                                message: { contains: rule.name },
                                status: 'SENT',
                            },
                        });
                        if (!ruleAlreadySent) {
                            const message = rule.template
                                .replace('{{employeeName}}', contract.employee.name)
                                .replace('{{contractNumber}}', contract.contractNumber || '-')
                                .replace('{{endDate}}', formatDate(endDate));
                            const result = await dispatchRule(contract, rule, message);
                            summary.rulesDispatched++;
                            summary.emailsSent += result.emailsSent;
                            summary.emailsFailed += result.emailsFailed;
                            console.log(`[Cron Alert] ${rule.channels.join('+')} dispatched for ${contract.employee.name} (${rule.name})`);
                        }
                    }
                }
                // Escalation for overdue contracts with no follow-up (from H+1 onward)
                // Skip escalation if the contract/employee is marked as Resign
                const isResigned = contract.notes?.toLowerCase().includes('resign');
                if (diffDays < 0 && !isResigned) {
                    const result = await runEscalation(contract);
                    if (result.escalated) {
                        summary.escalations++;
                    }
                    summary.emailsSent += result.emailsSent;
                    summary.emailsFailed += result.emailsFailed;
                }
            }
            catch (error) {
                const message = `Gagal proses kontrak ${contract.contractNumber} (${contract.id}): ${error?.message || String(error)}`;
                console.error(`[Cron Error] ${message}`);
                summary.errors.push(message);
            }
        }
        const detail = [
            `kontrak=${summary.contractsChecked}`,
            `rule=${summary.rulesDispatched}`,
            `eskalasi=${summary.escalations}`,
            `email terkirim=${summary.emailsSent}`,
            `email gagal=${summary.emailsFailed}`,
            ...(summary.errors.length > 0 ? [`error=${summary.errors.length}`] : []),
        ].join(', ');
        await (0, auditLogger_1.logAudit)(null, 'NOTIFICATION_CRON_RUN', 'CRON', `${summary.errors.length > 0 ? 'GAGAL PARSIAL: ' : ''}${detail}`);
    }
    catch (error) {
        const message = `Failed to run contract expiration check: ${error?.message || String(error)}`;
        console.error('[Cron Error]', message);
        summary.errors.push(message);
        await (0, auditLogger_1.logAudit)(null, 'NOTIFICATION_CRON_RUN', 'CRON', `GAGAL: ${message}`);
    }
    return summary;
}
function initCronJobs() {
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    const enableCron = process.env.ENABLE_CRON === 'true';
    // Nonaktifkan cron job & initial check otomatis di mode development
    // untuk mencegah terkirimnya email ke karyawan saat server start / hot reload
    if (process.env.ENABLE_CRON === 'false' || (isDev && !enableCron)) {
        console.log('[Cron] ⏸️ Cron scheduler & startup check dinonaktifkan di development.');
        console.log('[Cron] ℹ️ Set ENABLE_CRON=true di file .env jika ingin mengaktifkannya.');
        return;
    }
    // Run once daily at 01:00 AM
    node_cron_1.default.schedule('0 1 * * *', () => {
        runContractExpirationCheck();
    });
    // Run initial check on server startup
    if (process.env.SKIP_STARTUP_CRON_CHECK !== 'true') {
        setTimeout(() => {
            runContractExpirationCheck();
        }, 5000);
    }
    console.log('[Cron] Contract monitoring cron scheduler initialized.');
}
