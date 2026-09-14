import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { syncSystemNotificationsForUser } from '../services/cronService';
import { Prisma, Role } from '@prisma/client';

const router = Router();

const ROLES: Role[] = ['ADMIN'];

function isRequesterAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'ADMIN';
}

// GET /api/users
router.get('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        employeeId: true,
        employee: {
          select: { id: true, name: true, nik: true, department: true },
        },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(users);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil data user.' });
  }
});

// POST /api/users
router.post('/', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name, role, employeeId } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'Field wajib: Email, Password, Nama, dan Peran (Role).' });
    }

    if (!isRequesterAdmin(req) && role === 'ADMIN') {
      return res.status(403).json({ error: 'Hanya pengguna Full Access yang dapat membuat akun dengan peran Full Access.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: `User dengan email '${email}' sudah terdaftar.` });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        employeeId: employeeId || null,
        isActive: true,
      },
    });

    if (user.role === 'ADMIN' || user.role === 'MANAGEMENT') {
      await syncSystemNotificationsForUser(user.id, user.role);
    }

    await logAudit(req.user?.id, 'CREATE_USER', 'USER', `Created user account ${user.email} (${user.role})`, req.ip || '');

    return res.status(201).json({
      message: 'User berhasil dibuat.',
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat akun user baru.' });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, role, isActive, password, employeeId } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User tidak ditemukan.' });
    }

    if (!isRequesterAdmin(req)) {
      if (existing.role === 'ADMIN' || role === 'ADMIN') {
        return res.status(403).json({ error: 'Hanya pengguna Full Access yang dapat mengelola akun dengan peran Full Access.' });
      }
    }

    if (id === req.user?.id && (role && role !== existing.role)) {
      return res.status(400).json({ error: 'Anda tidak dapat mengubah peran akun sendiri.' });
    }

    if (id === req.user?.id && isActive === false) {
      return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' });
    }

    const updateData: Prisma.UserUpdateInput = {
      name: name || existing.name,
      role: role || existing.role,
      isActive: isActive !== undefined ? isActive : existing.isActive,
    };

    if (employeeId !== undefined) {
      updateData.employee = employeeId ? { connect: { id: employeeId } } : { disconnect: true };
    }

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    await logAudit(req.user?.id, 'UPDATE_USER', 'USER', `Updated user account ${updated.email}`, req.ip || '');

    return res.json({ message: 'User berhasil diperbarui.', user: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui user.' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', authenticateJWT, requireRole(ROLES), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    if (id === req.user?.id) {
      return res.status(400).json({ error: 'Anda tidak dapat menghapus akun sendiri.' });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'User tidak ditemukan.' });
    }

    if (!isRequesterAdmin(req) && existing.role === 'ADMIN') {
      return res.status(403).json({ error: 'Hanya pengguna Full Access yang dapat menghapus akun dengan peran Full Access.' });
    }

    await prisma.user.delete({ where: { id } });

    await logAudit(req.user?.id, 'DELETE_USER', 'USER', `Deleted user account ${existing.email}`, req.ip || '');

    return res.json({ message: 'User berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghapus user.' });
  }
});

export default router;
