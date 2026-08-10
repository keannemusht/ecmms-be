"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = __importDefault(require("../prisma"));
const cronService_1 = require("../services/cronService");
async function main() {
    console.log('[Test Cron] Running contract expiration check now...');
    await (0, cronService_1.runContractExpirationCheck)();
    console.log('[Test Cron] Done. Check NotificationLog (or Notifications -> Log Pengiriman in the UI) for results.');
}
main()
    .catch((e) => {
    console.error('[Test Cron] Error:', e);
    process.exit(1);
})
    .finally(() => prisma_1.default.$disconnect());
