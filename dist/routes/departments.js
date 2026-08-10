"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const auditLogger_1 = require("../utils/auditLogger");
const router = (0, express_1.Router)();
const ROLES = ['ADMIN', 'MANAGEMENT'];
// GET /api/departments
router.get('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const departments = await prisma_1.default.department.findMany({
            orderBy: { name: 'asc' },
        });
        return res.json(departments);
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil daftar departemen.' });
    }
});
// POST /api/departments
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Nama departemen wajib diisi.' });
        }
        const existing = await prisma_1.default.department.findUnique({ where: { name: String(name).trim() } });
        if (existing) {
            return res.status(400).json({ error: `Departemen '${name}' sudah terdaftar.` });
        }
        const department = await prisma_1.default.department.create({
            data: { name: String(name).trim() },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_DEPARTMENT', 'DEPARTMENT', `Created department ${department.name}`, req.ip || '');
        return res.status(201).json({ message: 'Departemen berhasil dibuat.', department });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat departemen.' });
    }
});
// PUT /api/departments/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, isActive } = req.body;
        const existing = await prisma_1.default.department.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Departemen tidak ditemukan.' });
        }
        const updateData = {};
        if (name !== undefined) {
            const trimmed = String(name).trim();
            if (!trimmed) {
                return res.status(400).json({ error: 'Nama departemen wajib diisi.' });
            }
            const dup = await prisma_1.default.department.findFirst({ where: { name: trimmed, NOT: { id } } });
            if (dup) {
                return res.status(400).json({ error: `Departemen '${name}' sudah terdaftar.` });
            }
            updateData.name = trimmed;
        }
        if (isActive !== undefined) {
            updateData.isActive = Boolean(isActive);
        }
        const department = await prisma_1.default.department.update({ where: { id }, data: updateData });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_DEPARTMENT', 'DEPARTMENT', `Updated department ${department.name}`, req.ip || '');
        return res.json({ message: 'Departemen berhasil diperbarui.', department });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui departemen.' });
    }
});
// DELETE /api/departments/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.department.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Departemen tidak ditemukan.' });
        }
        await prisma_1.default.department.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_DEPARTMENT', 'DEPARTMENT', `Deleted department ${existing.name}`, req.ip || '');
        return res.json({ message: 'Departemen berhasil dihapus.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus departemen.' });
    }
});
exports.default = router;
