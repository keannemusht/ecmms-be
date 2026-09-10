"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEmployeeContractStatuses = normalizeEmployeeContractStatuses;
const prisma_1 = __importDefault(require("../prisma"));
function startOfToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}
/**
 * Normalizes contract statuses for one or all employees.
 * Rules:
 * 1. An employee's contracts are ordered by sequence ASC, startDate ASC, createdAt ASC.
 * 2. All contracts except the latest (highest sequence) are succeeded/historical contracts.
 *    If an older contract has status EXPIRED, AKTIF, or AKAN_BERAKHIR, it is updated to DIPERPANJANG.
 * 3. The latest contract's status is dynamically updated based on current date:
 *    - PKWTT -> AKTIF
 *    - endDate < today -> EXPIRED
 *    - endDate <= today + 30 days -> AKAN_BERAKHIR
 *    - endDate > today + 30 days -> AKTIF
 */
async function normalizeEmployeeContractStatuses(targetEmployeeId) {
    const today = startOfToday();
    let contractsUpdated = 0;
    let employeesProcessed = 0;
    try {
        const whereClause = targetEmployeeId ? { id: targetEmployeeId } : {};
        const employees = await prisma_1.default.employee.findMany({
            where: whereClause,
            select: {
                id: true,
                employmentType: true,
                contracts: {
                    orderBy: [{ sequence: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
                },
            },
        });
        for (const emp of employees) {
            employeesProcessed++;
            const contracts = emp.contracts;
            if (contracts.length === 0)
                continue;
            const totalContracts = contracts.length;
            for (let i = 0; i < totalContracts; i++) {
                const contract = contracts[i];
                const isLatest = i === totalContracts - 1;
                const notesLower = (contract.notes || '').toLowerCase();
                const isContractResign = contract.status === 'RESIGN' ||
                    notesLower.includes('resign') ||
                    notesLower.includes('exit') ||
                    notesLower.includes('keluar');
                if (isContractResign) {
                    if (contract.status !== 'RESIGN') {
                        await prisma_1.default.contract.update({
                            where: { id: contract.id },
                            data: { status: 'RESIGN' },
                        });
                        contractsUpdated++;
                    }
                    continue;
                }
                if (!isLatest) {
                    // Historical contract: keep as AKTIF (unless RESIGN)
                    if (contract.status !== 'RESIGN' && contract.status !== 'AKTIF') {
                        await prisma_1.default.contract.update({
                            where: { id: contract.id },
                            data: { status: 'AKTIF' },
                        });
                        contractsUpdated++;
                    }
                }
                else {
                    // Latest contract: evaluate status based on end date & employment type
                    let targetStatus = 'AKTIF';
                    if (emp.employmentType === 'PKWTT' || contract.contractType === 'PKWTT') {
                        targetStatus = 'AKTIF';
                    }
                    else {
                        const endDate = new Date(contract.endDate);
                        endDate.setHours(0, 0, 0, 0);
                        const diffTime = endDate.getTime() - today.getTime();
                        const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
                        if (diffDays <= 0) {
                            targetStatus = 'EXPIRED';
                        }
                        else if (diffDays <= 30) {
                            targetStatus = 'AKAN_BERAKHIR';
                        }
                        else {
                            targetStatus = 'AKTIF';
                        }
                    }
                    if (contract.status !== targetStatus) {
                        await prisma_1.default.contract.update({
                            where: { id: contract.id },
                            data: { status: targetStatus },
                        });
                        contractsUpdated++;
                    }
                }
            }
        }
    }
    catch (error) {
        console.error('Error normalizing employee contract statuses:', error);
    }
    return { employeesProcessed, contractsUpdated };
}
