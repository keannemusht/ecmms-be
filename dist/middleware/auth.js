"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.authenticateJWT = authenticateJWT;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = __importDefault(require("../prisma"));
const secret = process.env.JWT_SECRET;
if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to your .env file.');
}
exports.JWT_SECRET = secret;
function extractToken(req) {
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
async function authenticateJWT(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Akses ditolak. Token autentikasi tidak ditemukan.' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
        try {
            // Re-verify against the DB so role changes / deactivation take effect immediately.
            const freshUser = await prisma_1.default.user.findUnique({
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
        }
        catch (error) {
            return res.status(500).json({ error: 'Gagal memverifikasi pengguna.' });
        }
    }
    catch (error) {
        return res.status(403).json({ error: 'Token tidak valid atau telah kadaluarsa.' });
    }
}
function requireRole(allowedRoles) {
    return (req, res, next) => {
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
