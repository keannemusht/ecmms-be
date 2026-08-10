import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { Role } from '@prisma/client';

const router = Router();

const ROLES: Role[] = ['ADMIN', 'MANAGEMENT'];

// GET /api/departments
router.get('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
    return res.json(departments);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil daftar departemen.' });
  }
});

// POST /api/departments
router.post('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nama departemen wajib diisi.' });
    }

    const existing = await prisma.department.findUnique({ where: { name: String(name).trim() } });
    if (existing) {
      return res.status(400).json({ error: `Departemen '${name}' sudah terdaftar.` });
    }

    const department = await prisma.department.create({
      data: { name: String(name).trim() },
    });

    await logAudit(req.user?.id, 'CREATE_DEPARTMENT', 'DEPARTMENT', `Created department ${department.name}`, req.ip || '');

    return res.status(201).json({ message: 'Departemen berhasil dibuat.', department });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat departemen.' });
  }
});

// PUT /api/departments/:id
router.put('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, isActive } = req.body;

    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Departemen tidak ditemukan.' });
    }

    const updateData: { name?: string; isActive?: boolean } = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Nama departemen wajib diisi.' });
      }
      const dup = await prisma.department.findFirst({ where: { name: trimmed, NOT: { id } } });
      if (dup) {
        return res.status(400).json({ error: `Departemen '${name}' sudah terdaftar.` });
      }
      updateData.name = trimmed;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const department = await prisma.department.update({ where: { id }, data: updateData });

    await logAudit(req.user?.id, 'UPDATE_DEPARTMENT', 'DEPARTMENT', `Updated department ${department.name}`, req.ip || '');

    return res.json({ message: 'Departemen berhasil diperbarui.', department });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui departemen.' });
  }
});

// DELETE /api/departments/:id
router.delete('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.department.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Departemen tidak ditemukan.' });
    }

    await prisma.department.delete({ where: { id } });
    await logAudit(req.user?.id, 'DELETE_DEPARTMENT', 'DEPARTMENT', `Deleted department ${existing.name}`, req.ip || '');

    return res.json({ message: 'Departemen berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghapus departemen.' });
  }
});

export default router;
