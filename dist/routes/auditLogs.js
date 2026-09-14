"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/audit-logs (Admin Only)
router.get('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const { action, entity, search, page, limit } = req.query;
        const whereClause = {};
        if (action)
            whereClause.action = String(action);
        if (entity)
            whereClause.entity = String(entity);
        const s = search ? String(search).trim() : '';
        if (s) {
            whereClause.OR = [
                { action: { contains: s, mode: 'insensitive' } },
                { entity: { contains: s, mode: 'insensitive' } },
                { details: { contains: s, mode: 'insensitive' } },
                { user: { name: { contains: s, mode: 'insensitive' } } },
                { user: { email: { contains: s, mode: 'insensitive' } } },
                { ipAddress: { contains: s, mode: 'insensitive' } },
            ];
        }
        const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
        const [logs, total] = await Promise.all([
            prisma_1.default.auditLog.findMany({
                where: whereClause,
                include: {
                    user: { select: { id: true, name: true, email: true, role: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.default.auditLog.count({ where: whereClause }),
        ]);
        return res.json({
            logs,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.max(1, Math.ceil(total / limitNum)),
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil data audit log.' });
    }
});
exports.default = router;
