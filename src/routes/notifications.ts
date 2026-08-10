import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { buildWhatsAppLink } from '../services/whatsappNotification';
import { Prisma } from '@prisma/client';

const router = Router();

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  expiration: ['kontrak', 'contract', 'jatuh', 'berakhir', 'expire', 'expiring'],
  submission: ['pengajuan', 'submission', 'form', 'perpanjangan', 'renewal'],
  escalation: ['eskalasi', 'escalation', 'overdue', 'urgent'],
};

// POST /api/notifications/in-app/:id/send-whatsapp — build wa.me link to the employee's number
router.post('/in-app/:id/send-whatsapp', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.user?.id;

    const notification = await prisma.inAppNotification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notifikasi tidak ditemukan.' });
    }

    if (!notification.whatsappPhone || !notification.whatsappMessage) {
      return res.status(400).json({ error: 'Notifikasi ini tidak memiliki aksi kirim WhatsApp.' });
    }

    const link = buildWhatsAppLink(notification.whatsappPhone, notification.whatsappMessage);
    if (!link) {
      return res.status(400).json({ error: 'Nomor WhatsApp karyawan tidak valid.' });
    }

    if (notification.contractId) {
      await prisma.notificationLog.create({
        data: {
          contractId: notification.contractId,
          recipient: notification.whatsappPhone,
          channel: 'WHATSAPP',
          status: 'SENT',
          message: link,
        },
      });
    }

    await prisma.inAppNotification.updateMany({
      where: { id },
      data: { isRead: true },
    });

    await logAudit(req.user?.id, 'SEND_WHATSAPP', 'NOTIFICATION', `WhatsApp link dibuka untuk ${notification.whatsappPhone}`, req.ip || '');

    return res.json({ link, phone: notification.whatsappPhone });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat link WhatsApp.' });
  }
});

// GET /api/notifications/in-app
router.get('/in-app', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const pageNum = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const category = String(req.query.category || 'all');

    const where: Prisma.InAppNotificationWhereInput = { userId };
    if (category !== 'all' && CATEGORY_KEYWORDS[category]) {
      where.OR = CATEGORY_KEYWORDS[category].flatMap((k) => [
        { title: { contains: k, mode: 'insensitive' } },
        { message: { contains: k, mode: 'insensitive' } },
      ]);
    }

    const [notifications, total] = await Promise.all([
      prisma.inAppNotification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.inAppNotification.count({ where }),
    ]);

    const unreadCount = await prisma.inAppNotification.count({
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
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil notifikasi In-App.' });
  }
});

// PUT /api/notifications/in-app/:id/read
router.put('/in-app/:id/read', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = req.user?.id;

    await prisma.inAppNotification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });

    return res.json({ message: 'Notifikasi ditandai sebagai dibaca.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui notifikasi.' });
  }
});

// PUT /api/notifications/in-app/read-all
router.put('/in-app/read-all', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    await prisma.inAppNotification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return res.json({ message: 'Semua notifikasi berhasil ditandai sebagai dibaca.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui semua notifikasi.' });
  }
});

// GET /api/notifications/rules
router.get('/rules', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const rules = await prisma.notificationRule.findMany({
      orderBy: { daysBefore: 'desc' },
    });
    return res.json(rules);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil aturan notifikasi.' });
  }
});

// POST /api/notifications/rules
router.post('/rules', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { name, daysBefore, channels, targetRoles, template, isActive } = req.body;

    if (
      !name ||
      daysBefore === undefined ||
      !Array.isArray(channels) ||
      channels.length === 0 ||
      !Array.isArray(targetRoles) ||
      targetRoles.length === 0 ||
      !template
    ) {
      return res.status(400).json({ error: 'Semua field wajib diisi.' });
    }

    const rule = await prisma.notificationRule.create({
      data: {
        name,
        daysBefore: parseInt(daysBefore),
        channels,
        targetRoles,
        template,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    await logAudit(req.user?.id, 'CREATE_NOTIF_RULE', 'NOTIFICATION_RULE', `Created rule ${rule.name}`, req.ip || '');

    return res.status(201).json({ message: 'Aturan notifikasi berhasil dibuat.', rule });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat aturan notifikasi.' });
  }
});

// PUT /api/notifications/rules/:id
router.put('/rules/:id', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, daysBefore, channels, targetRoles, template, isActive } = req.body;

    const existing = await prisma.notificationRule.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Aturan notifikasi tidak ditemukan.' });
    }

    const updated = await prisma.notificationRule.update({
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

    await logAudit(req.user?.id, 'UPDATE_NOTIF_RULE', 'NOTIFICATION_RULE', `Updated rule ${updated.name}`, req.ip || '');

    return res.json({ message: 'Aturan notifikasi berhasil diperbarui.', rule: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui aturan notifikasi.' });
  }
});

// GET /api/notifications/logs
router.get('/logs', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const pageNum = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));

    const [logs, total] = await Promise.all([
      prisma.notificationLog.findMany({
        include: {
          contract: {
            include: { employee: true },
          },
        },
        orderBy: { sentAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.notificationLog.count(),
    ]);

    return res.json({
      logs,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil log pengiriman notifikasi.' });
  }
});

export default router;
