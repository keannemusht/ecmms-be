"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = __importDefault(require("../prisma"));
function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}
function formatDate(d) {
    return d.toISOString().split('T')[0];
}
async function main() {
    console.log('=== NOTIFICATION RULES ===');
    const rules = await prisma_1.default.notificationRule.findMany({ orderBy: { daysBefore: 'asc' } });
    for (const rule of rules) {
        console.log(`- "${rule.name}" | daysBefore=${rule.daysBefore} | active=${rule.isActive} | channels=[${rule.channels.join(',')}] | targets=[${rule.targetRoles.join(',')}]`);
    }
    console.log('\n=== CONTRACTS (cron view) ===');
    const today = startOfToday();
    const contracts = await prisma_1.default.contract.findMany({
        where: { status: { notIn: ['DIPERPANJANG', 'RESIGN'] }, contractType: { not: 'PKWTT' } },
        include: { employee: { include: { user: true } } },
        orderBy: { endDate: 'asc' },
    });
    console.log(`Today (local midnight): ${today.toString()} | total contracts in scope: ${contracts.length}`);
    console.log('');
    let matched = 0;
    for (const contract of contracts) {
        const endDate = new Date(contract.endDate);
        endDate.setHours(0, 0, 0, 0);
        const diffTime = endDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
        const matchingRules = rules.filter((r) => r.isActive && r.daysBefore === diffDays);
        console.log(`- ${contract.contractNumber} | emp=${contract.employee.name} | status=${contract.status}`);
        console.log(`    endDate raw=${contract.endDate} | endDate(00:00)=${formatDate(endDate)} | diffDays=${diffDays}`);
        if (matchingRules.length > 0) {
            matched++;
            console.log(`    >>> MATCHED rules: ${matchingRules.map((r) => `"${r.name}"(daysBefore=${r.daysBefore})`).join(', ')}`);
            for (const rule of matchingRules) {
                const target = rule.targetRoles[0];
                let email = '';
                if (target === 'USER') {
                    email = contract.employee?.user?.email || contract.employee?.email || '';
                }
                else {
                    const users = await prisma_1.default.user.findMany({
                        where: { role: { in: ['ADMIN', 'MANAGEMENT'] } },
                    });
                    email = users.map((u) => u.email).filter(Boolean).join(', ');
                }
                console.log(`    channels=[${rule.channels.join(',')}] -> email recipients: ${email || '(NONE!)'}`);
            }
        }
        else {
            console.log(`    (no matching rule for diffDays=${diffDays})`);
        }
    }
    console.log(`\nTotal contracts that WOULD trigger: ${matched}`);
    console.log('\n=== RECENT NOTIFICATION LOGS (last 48h) ===');
    const since = new Date(Date.now() - 48 * 3600 * 1000);
    const logs = await prisma_1.default.notificationLog.findMany({
        where: { sentAt: { gte: since } },
        orderBy: { sentAt: 'desc' },
        take: 20,
    });
    if (logs.length === 0) {
        console.log('(no logs in the last 48h)');
    }
    else {
        for (const log of logs) {
            console.log(`- [${log.sentAt.toISOString()}] ${log.channel} | ${log.status} | to=${log.recipient} | contract=${log.contractId} | err=${log.error || '-'}`);
        }
    }
}
main()
    .catch((e) => {
    console.error('Debug script error:', e);
    process.exit(1);
})
    .finally(() => prisma_1.default.$disconnect());
