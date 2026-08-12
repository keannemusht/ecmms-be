"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const auditLogger_1 = require("../utils/auditLogger");
const whatsappNotification_1 = require("../services/whatsappNotification");
const router = (0, express_1.Router)();
const CATEGORY_KEYWORDS = {
    expiration: ['kontrak', 'contract', 'jatuh', 'berakhir', 'expire', 'expiring'],
    submission: ['pengajuan', 'submission', 'form', 'perpanjangan', 'renewal'],
    escalation: ['eskalasi', 'escalation', 'overdue', 'urgent'],
};
// POST /api/notifications/in-app/:id/send-whatsapp — build wa.me link to the employee's number
router.post('/in-app/:id/send-whatsapp', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const userId = req.user?.id;
        const notification = await prisma_1.default.inAppNotification.findFirst({
            where: { id, userId },
        });
        if (!notification) {
            return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
        }
        if (!notification.whatsappPhone || !notification.whatsappMessage) {
            return res.status(400).json({ error: 'Notifikasi ini tidak memiliki aksi kirim WhatsApp.' });
        }
        const link = (0, whatsappNotification_1.buildWhatsAppLink)(notification.whatsappPhone, notification.whatsappMessage);
        if (!link) {
            return res.status(400).json({ error: 'Nomor WhatsApp karyawan tidak valid.' });
        }
        if (notification.contractId) {
            await prisma_1.default.notificationLog.create({
                data: {
                    contractId: notification.contractId,
                    recipient: notification.whatsappPhone,
                    channel: 'WHATSAPP',
                    status: 'SENT',
                    message: link,
                },
            });
        }
        await prisma_1.default.inAppNotification.updateMany({
            where: { id },
            data: { isRead: true },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'SEND_WHATSAPP', 'NOTIFICATION', `WhatsApp link dibuka untuk ${notification.whatsappPhone}`, req.ip || '');
        return res.json({ link, phone: notification.whatsappPhone });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat link WhatsApp.' });
    }
});
// GET /api/notifications/in-app
router.get('/in-app', auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user?.id;
        const pageNum = Math.max(1, parseInt(String(req.query.page), 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
        const category = String(req.query.category || 'all');
        const where = { userId };
        if (category !== 'all' && CATEGORY_KEYWORDS[category]) {
            where.OR = CATEGORY_KEYWORDS[category].flatMap((k) => [
                { title: { contains: k, mode: 'insensitive' } },
                { message: { contains: k, mode: 'insensitive' } },
            ]);
        }
        const [notifications, total] = await Promise.all([
            prisma_1.default.inAppNotification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.default.inAppNotification.count({ where }),
        ]);
        const unreadCount = await prisma_1.default.inAppNotification.count({
            where: { userId, isRead: false },
        });
        return res.json({
            notifications,
            unreadCount,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.max(1, Math.ceil(total / limitNum)),
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil notifikasi In-App.' });
    }
});
// PUT /api/notifications/in-app/:id/read
router.put('/in-app/:id/read', auth_1.authenticateJWT, async (req, res) => {
    try {
        const id = String(req.params.id);
        const userId = req.user?.id;
        await prisma_1.default.inAppNotification.updateMany({
            where: { id, userId },
            data: { isRead: true },
        });
        return res.json({ message: 'Notifikasi ditandai sebagai dibaca.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui notifikasi.' });
    }
});
// DELETE /api/notifications/in-app — clear all in-app notifications for the current user
router.delete('/in-app', auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user?.id;
        const result = await prisma_1.default.inAppNotification.deleteMany({
            where: { userId },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CLEAR_NOTIFICATIONS', 'NOTIFICATION', `Cleared ${result.count} in-app notifications`, req.ip || '');
        return res.json({ message: 'Semua notifikasi berhasil dihapus.', deleted: result.count });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus notifikasi.' });
    }
});
// PUT /api/notifications/in-app/read-all
router.put('/in-app/read-all', auth_1.authenticateJWT, async (req, res) => {
    try {
        const userId = req.user?.id;
        await prisma_1.default.inAppNotification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true },
        });
        return res.json({ message: 'Semua notifikasi berhasil ditandai sebagai dibaca.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui semua notifikasi.' });
    }
});
// GET /api/notifications/rules
router.get('/rules', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const rules = await prisma_1.default.notificationRule.findMany({
            orderBy: { daysBefore: 'desc' },
        });
        return res.json(rules);
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil aturan notifikasi.' });
    }
});
// POST /api/notifications/rules
router.post('/rules', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const { name, daysBefore, channels, targetRoles, template, isActive } = req.body;
        if (!name ||
            daysBefore === undefined ||
            !Array.isArray(channels) ||
            channels.length === 0 ||
            !Array.isArray(targetRoles) ||
            targetRoles.length === 0 ||
            !template) {
            return res.status(400).json({ error: 'Semua field wajib diisi.' });
        }
        const rule = await prisma_1.default.notificationRule.create({
            data: {
                name,
                daysBefore: parseInt(daysBefore),
                channels,
                targetRoles,
                template,
                isActive: isActive !== undefined ? isActive : true,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_NOTIF_RULE', 'NOTIFICATION_RULE', `Created rule ${rule.name}`, req.ip || '');
        return res.status(201).json({ message: 'Aturan notifikasi berhasil dibuat.', rule });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat aturan notifikasi.' });
    }
});
// PUT /api/notifications/rules/:id
router.put('/rules/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, daysBefore, channels, targetRoles, template, isActive } = req.body;
        const existing = await prisma_1.default.notificationRule.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Aturan notifikasi tidak ditemukan.' });
        }
        const updated = await prisma_1.default.notificationRule.update({
            where: { id },
            data: {
                name: name || existing.name,
                daysBefore: daysBefore !== undefined ? parseInt(daysBefore) : existing.daysBefore,
                channels: Array.isArray(channels) && channels.length > 0 ? channels : existing.channels,
                targetRoles: Array.isArray(targetRoles) && targetRoles.length > 0 ? targetRoles : existing.targetRoles,
                template: template || existing.template,
                isActive: isActive !== undefined ? isActive : existing.isActive,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_NOTIF_RULE', 'NOTIFICATION_RULE', `Updated rule ${updated.name}`, req.ip || '');
        return res.json({ message: 'Aturan notifikasi berhasil diperbarui.', rule: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui aturan notifikasi.' });
    }
});
// GET /api/notifications/logs
router.get('/logs', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const pageNum = Math.max(1, parseInt(String(req.query.page), 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
        const [logs, total] = await Promise.all([
            prisma_1.default.notificationLog.findMany({
                include: {
                    contract: {
                        include: { employee: true },
                    },
                },
                orderBy: { sentAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
            }),
            prisma_1.default.notificationLog.count(),
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
        return res.status(500).json({ error: 'Gagal mengambil log pengiriman notifikasi.' });
    }
});
// DELETE /api/notifications/logs/:id — delete a single delivery log
router.delete('/logs/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.notificationLog.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Log pengiriman tidak ditemukan.' });
        }
        await prisma_1.default.notificationLog.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_NOTIF_LOG', 'NOTIFICATION_LOG', `Deleted delivery log untuk ${existing.recipient} (${existing.channel})`, req.ip || '');
        return res.json({ message: 'Log pengiriman berhasil dihapus.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus log pengiriman.' });
    }
});
// DELETE /api/notifications/logs — clear all delivery logs
router.delete('/logs', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const result = await prisma_1.default.notificationLog.deleteMany();
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CLEAR_NOTIF_LOGS', 'NOTIFICATION_LOG', `Cleared ${result.count} delivery logs`, req.ip || '');
        return res.json({ message: 'Semua log pengiriman berhasil dihapus.', deleted: result.count });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus semua log pengiriman.' });
    }
});
exports.default = router;
