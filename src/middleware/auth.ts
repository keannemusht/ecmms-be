import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import prisma from '../prisma';

const secret = process.env.JWT_SECRET;

if (!secret) {
  throw new Error('JWT_SECRET is not set. Add it to your .env file.');
}

export const JWT_SECRET: string = secret;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    employeeId?: string | null;
  };
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const raw = req.headers.cookie;
  if (raw) {
    const pair = raw
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('ecmms_token='));
    if (pair) {
      return decodeURIComponent(pair.slice('ecmms_token='.length));
    }
  }
  return undefined;
}

export async function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Akses ditolak. Token autentikasi tidak ditemukan.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email?: string;
      name?: string;
      role?: Role;
      employeeId?: string | null;
    };

    try {
      // Re-verify against the DB so role changes / deactivation take effect immediately.
      const freshUser = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, role: true, isActive: true, employeeId: true },
      });

      if (!freshUser || !freshUser.isActive) {
        return res.status(401).json({ error: 'Akun tidak ditemukan atau dinonaktifkan.' });
      }

      req.user = {
        id: freshUser.id,
        email: freshUser.email,
        name: freshUser.name,
        role: freshUser.role,
        employeeId: freshUser.employeeId,
      };

      next();
    } catch (error) {
      return res.status(500).json({ error: 'Gagal memverifikasi pengguna.' });
    }
  } catch (error) {
    return res.status(403).json({ error: 'Token tidak valid atau telah kadaluarsa.' });
  }
}

export function requireRole(allowedRoles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Pengguna belum terautentikasi.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Akses ditolak. Peran '${req.user.role}' tidak memiliki izin untuk fitur ini.`,
      });
    }

    next();
  };
}
