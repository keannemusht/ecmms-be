"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = logAudit;
const prisma_1 = __importDefault(require("../prisma"));
async function logAudit(userId, action, entity, details, ipAddress) {
    try {
        await prisma_1.default.auditLog.create({
            data: {
                userId: userId || null,
                action,
                entity,
                details: details || null,
                ipAddress: ipAddress || null,
            },
        });
    }
    catch (error) {
        console.error('Failed to log audit activity:', error);
    }
}
