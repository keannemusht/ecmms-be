"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = __importDefault(require("../prisma"));
const employeeLevel_1 = require("../lib/employeeLevel");
async function main() {
    console.log('[Update Employee Levels] Starting position-based level synchronization...');
    // 1. Convert any explicit 'Non-Staff' to 'Worker' directly
    const nonStaffRes = await prisma_1.default.employee.updateMany({
        where: { level: 'Non-Staff' },
        data: { level: 'Worker' },
    });
    console.log(`Converted ${nonStaffRes.count} employees from 'Non-Staff' to 'Worker'.`);
    // 2. Process all unique positions
    const employees = await prisma_1.default.employee.findMany({
        select: {
            position: true,
        },
    });
    console.log(`Found ${employees.length} total employees.`);
    const uniquePositions = [...new Set(employees.map((e) => e.position || ''))];
    console.log(`Found ${uniquePositions.length} unique positions to process.`);
    let totalUpdated = 0;
    for (const pos of uniquePositions) {
        const targetLevel = (0, employeeLevel_1.determineEmployeeLevel)(pos);
        const res = await prisma_1.default.employee.updateMany({
            where: {
                position: pos,
                level: { not: targetLevel },
            },
            data: {
                level: targetLevel,
            },
        });
        if (res.count > 0) {
            console.log(`Updated position "${pos}" -> ${targetLevel} (${res.count} employees)`);
            totalUpdated += res.count;
        }
    }
    // 3. Update ContractEvaluation records with 'Non-Staff'
    const evRes = await prisma_1.default.contractEvaluation.updateMany({
        where: { employeeLevel: 'Non-Staff' },
        data: { employeeLevel: 'Worker' },
    });
    console.log(`Updated ${evRes.count} ContractEvaluation records from 'Non-Staff' to 'Worker'.`);
    console.log(`\nTotal employee level updates executed: ${totalUpdated}`);
    // Summary counts
    const summary = await prisma_1.default.employee.groupBy({
        by: ['level'],
        _count: {
            id: true,
        },
    });
    console.log('\nFinal distribution by level:');
    console.table(summary.map((s) => ({ level: s.level, count: s._count.id })));
}
main()
    .catch((err) => {
    console.error('[Update Failed]:', err);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.default.$disconnect();
    process.exit(0);
});
