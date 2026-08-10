import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { Role } from '@prisma/client';

const router = Router();

const ROLES: Role[] = ['ADMIN', 'MANAGEMENT'];

// GET /api/positions
router.get('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const positions = await prisma.position.findMany({
      orderBy: { name: 'asc' },
    });
    return res.json(positions);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil daftar jabatan.' });
  }
});

// POST /api/positions
router.post('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
    }

    const existing = await prisma.position.findUnique({ where: { name: String(name).trim() } });
    if (existing) {
      return res.status(400).json({ error: `Jabatan '${name}' sudah terdaftar.` });
    }

    const position = await prisma.position.create({
      data: { name: String(name).trim() },
    });

    await logAudit(req.user?.id, 'CREATE_POSITION', 'POSITION', `Created position ${position.name}`, req.ip || '');

    return res.status(201).json({ message: 'Jabatan berhasil dibuat.', position });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat jabatan.' });
  }
});

// PUT /api/positions/:id
router.put('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, isActive } = req.body;

    const existing = await prisma.position.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
    }

    const updateData: { name?: string; isActive?: boolean } = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
      }
      const dup = await prisma.position.findFirst({ where: { name: trimmed, NOT: { id } } });
      if (dup) {
        return res.status(400).json({ error: `Jabatan '${name}' sudah terdaftar.` });
      }
      updateData.name = trimmed;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    const position = await prisma.position.update({ where: { id }, data: updateData });

    await logAudit(req.user?.id, 'UPDATE_POSITION', 'POSITION', `Updated position ${position.name}`, req.ip || '');

    return res.json({ message: 'Jabatan berhasil diperbarui.', position });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui jabatan.' });
  }
});

// DELETE /api/positions/:id
router.delete('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.position.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
    }

    await prisma.position.delete({ where: { id } });
    await logAudit(req.user?.id, 'DELETE_POSITION', 'POSITION', `Deleted position ${existing.name}`, req.ip || '');

    return res.json({ message: 'Jabatan berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghapus jabatan.' });
  }
});

export default router;
