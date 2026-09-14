"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = __importDefault(require("../prisma"));
async function main() {
    console.log('[Clear Data] Starting clean up of employees, contracts, and related data...');
    const result = await prisma_1.default.$transaction(async (tx) => {
        // 1. Unlink employees from users so user accounts are never broken
        await tx.user.updateMany({
            data: { employeeId: null },
        });
        // 2. Delete related transaction data
        const deletedEvaluations = await tx.contractEvaluation.deleteMany({});
        const deletedSubmissions = await tx.submissionForm.deleteMany({});
        const deletedHistories = await tx.contractHistory.deleteMany({});
        const deletedNotifLogs = await tx.notificationLog.deleteMany({});
        const deletedInAppNotifs = await tx.inAppNotification.deleteMany({});
        // 3. Delete contracts & employees
        const deletedContracts = await tx.contract.deleteMany({});
        const deletedEmployees = await tx.employee.deleteMany({});
        return {
            deletedEmployees: deletedEmployees.count,
            deletedContracts: deletedContracts.count,
            deletedHistories: deletedHistories.count,
            deletedEvaluations: deletedEvaluations.count,
            deletedSubmissions: deletedSubmissions.count,
            deletedNotifLogs: deletedNotifLogs.count,
            deletedInAppNotifs: deletedInAppNotifs.count,
        };
    });
    console.log('[Clear Data] Successfully cleaned up database:');
    console.log(JSON.stringify(result, null, 2));
}
main()
    .catch((err) => {
    console.error('[Clear Data] Error during clean up:', err);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.default.$disconnect();
    process.exit(0);
});
