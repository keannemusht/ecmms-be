"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const auditLogger_1 = require("../utils/auditLogger");
const router = (0, express_1.Router)();
const ROLES = ['ADMIN'];
function isRequesterAdmin(req) {
    return req.user?.role === 'ADMIN';
}
// GET /api/users
router.get('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const users = await prisma_1.default.user.findMany({
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
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil data user.' });
    }
});
// POST /api/users
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const { email, password, name, role, employeeId } = req.body;
        if (!email || !password || !name || !role) {
            return res.status(400).json({ error: 'Field wajib: Email, Password, Nama, dan Peran (Role).' });
        }
        if (!isRequesterAdmin(req) && role === 'ADMIN') {
            return res.status(403).json({ error: 'Hanya Admin yang dapat membuat akun dengan peran ADMIN.' });
        }
        const existing = await prisma_1.default.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: `User dengan email '${email}' sudah terdaftar.` });
        }
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma_1.default.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role,
                employeeId: employeeId || null,
                isActive: true,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_USER', 'USER', `Created user account ${user.email} (${user.role})`, req.ip || '');
        return res.status(201).json({
            message: 'User berhasil dibuat.',
            user: { id: user.id, email: user.email, name: user.name, role: user.role },
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat akun user baru.' });
    }
});
// PUT /api/users/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, role, isActive, password, employeeId } = req.body;
        const existing = await prisma_1.default.user.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'User tidak ditemukan.' });
        }
        if (!isRequesterAdmin(req)) {
            if (existing.role === 'ADMIN' || role === 'ADMIN') {
                return res.status(403).json({ error: 'Hanya Admin yang dapat mengelola akun dengan peran ADMIN.' });
            }
        }
        if (id === req.user?.id && (role && role !== existing.role)) {
            return res.status(400).json({ error: 'Anda tidak dapat mengubah peran akun sendiri.' });
        }
        if (id === req.user?.id && isActive === false) {
            return res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun sendiri.' });
        }
        const updateData = {
            name: name || existing.name,
            role: role || existing.role,
            isActive: isActive !== undefined ? isActive : existing.isActive,
        };
        if (employeeId !== undefined) {
            updateData.employee = employeeId ? { connect: { id: employeeId } } : { disconnect: true };
        }
        if (password) {
            updateData.password = await bcryptjs_1.default.hash(password, 10);
        }
        const updated = await prisma_1.default.user.update({
            where: { id },
            data: updateData,
            select: { id: true, email: true, name: true, role: true, isActive: true },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_USER', 'USER', `Updated user account ${updated.email}`, req.ip || '');
        return res.json({ message: 'User berhasil diperbarui.', user: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui user.' });
    }
});
// DELETE /api/users/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        if (id === req.user?.id) {
            return res.status(400).json({ error: 'Anda tidak dapat menghapus akun sendiri.' });
        }
        const existing = await prisma_1.default.user.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'User tidak ditemukan.' });
        }
        if (!isRequesterAdmin(req) && existing.role === 'ADMIN') {
            return res.status(403).json({ error: 'Hanya Admin yang dapat menghapus akun dengan peran ADMIN.' });
        }
        await prisma_1.default.user.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_USER', 'USER', `Deleted user account ${existing.email}`, req.ip || '');
        return res.json({ message: 'User berhasil dihapus.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus user.' });
    }
});
exports.default = router;
