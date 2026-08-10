import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { Prisma } from '@prisma/client';

const router = Router();

// GET /api/audit-logs (Admin Only)
router.get('/', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { action, entity, search, page, limit } = req.query;

    const whereClause: Prisma.AuditLogWhereInput = {};
    if (action) whereClause.action = String(action);
    if (entity) whereClause.entity = String(entity);

    const s = search ? String(search).trim() : '';
    if (s) {
      whereClause.OR = [
        { action: { contains: s, mode: 'insensitive' } },
        { entity: { contains: s, mode: 'insensitive' } },
        { details: { contains: s, mode: 'insensitive' } },
        { user: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: whereClause,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.auditLog.count({ where: whereClause }),
    ]);

    return res.json({
      logs,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil data audit log.' });
  }
});

export default router;
