import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';

const router = Router();

const TOKEN_COOKIE = 'ecmms_token';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 1 day

function cookieOptions(maxAge = COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge,
    path: '/',
  };
}

// POST /api/auth/login
router.post('/login', async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password harus diisi.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        employee: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Email atau password salah, atau akun dinonaktifkan.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      employeeId: user.employeeId,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

    res.cookie(TOKEN_COOKIE, token, cookieOptions());

    await logAudit(user.id, 'LOGIN', 'USER', `User ${user.email} logged in successfully`, req.ip);

    return res.json({
      message: 'Login berhasil',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        employeeId: user.employeeId,
        employee: user.employee,
      },
    });
  } catch (error) {
    console.error('Error logging in:', error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server saat login.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: AuthRequest, res: Response) => {
  res.clearCookie(TOKEN_COOKIE, cookieOptions(0));
  return res.json({ message: 'Logout berhasil' });
});

// GET /api/auth/me
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        employeeId: true,
        employee: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    }

    return res.json(user);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil data profil user.' });
  }
});

export default router;
