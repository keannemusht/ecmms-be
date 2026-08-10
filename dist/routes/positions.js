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
// GET /api/positions
router.get('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const positions = await prisma_1.default.position.findMany({
            orderBy: { name: 'asc' },
        });
        return res.json(positions);
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil daftar jabatan.' });
    }
});
// POST /api/positions
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
        }
        const existing = await prisma_1.default.position.findUnique({ where: { name: String(name).trim() } });
        if (existing) {
            return res.status(400).json({ error: `Jabatan '${name}' sudah terdaftar.` });
        }
        const position = await prisma_1.default.position.create({
            data: { name: String(name).trim() },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_POSITION', 'POSITION', `Created position ${position.name}`, req.ip || '');
        return res.status(201).json({ message: 'Jabatan berhasil dibuat.', position });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat jabatan.' });
    }
});
// PUT /api/positions/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, isActive } = req.body;
        const existing = await prisma_1.default.position.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        }
        const updateData = {};
        if (name !== undefined) {
            const trimmed = String(name).trim();
            if (!trimmed) {
                return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
            }
            const dup = await prisma_1.default.position.findFirst({ where: { name: trimmed, NOT: { id } } });
            if (dup) {
                return res.status(400).json({ error: `Jabatan '${name}' sudah terdaftar.` });
            }
            updateData.name = trimmed;
        }
        if (isActive !== undefined) {
            updateData.isActive = Boolean(isActive);
        }
        const position = await prisma_1.default.position.update({ where: { id }, data: updateData });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_POSITION', 'POSITION', `Updated position ${position.name}`, req.ip || '');
        return res.json({ message: 'Jabatan berhasil diperbarui.', position });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui jabatan.' });
    }
});
// DELETE /api/positions/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(ROLES), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.position.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        }
        await prisma_1.default.position.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_POSITION', 'POSITION', `Deleted position ${existing.name}`, req.ip || '');
        return res.json({ message: 'Jabatan berhasil dihapus.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus jabatan.' });
    }
});
exports.default = router;
