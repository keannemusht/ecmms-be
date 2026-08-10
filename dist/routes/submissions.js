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
// GET /api/submissions
router.get('/', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { status, type } = req.query;
        const whereClause = {};
        if (req.user?.role === 'USER') {
            if (!req.user.employeeId) {
                return res.json({ submissions: [], total: 0 });
            }
            whereClause.employeeId = req.user.employeeId;
        }
        else {
            if (status) {
                whereClause.status = status;
            }
            if (type) {
                whereClause.submissionType = type;
            }
        }
        const submissions = await prisma_1.default.submissionForm.findMany({
            where: whereClause,
            include: {
                employee: true,
                processedBy: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({ submissions, total: submissions.length });
    }
    catch (error) {
        console.error('Error fetching submissions:', error);
        return res.status(500).json({ error: 'Gagal mengambil data pengajuan.' });
    }
});
// POST /api/submissions
router.post('/', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { submissionType, reason } = req.body;
        if (!submissionType || !reason) {
            return res.status(400).json({ error: 'Jenis pengajuan dan alasan harus diisi.' });
        }
        let employeeId = req.user?.employeeId;
        if (req.user?.role !== 'USER' && req.body.employeeId) {
            employeeId = req.body.employeeId;
        }
        if (!employeeId) {
            return res.status(400).json({ error: 'Akun Anda tidak terhubung dengan data karyawan.' });
        }
        const submission = await prisma_1.default.submissionForm.create({
            data: {
                employeeId,
                submissionType,
                reason,
                status: 'PENDING',
            },
            include: { employee: true },
        });
        const hrUsers = await prisma_1.default.user.findMany({
            where: { role: { in: ['ADMIN', 'MANAGEMENT'] } },
        });
        for (const hr of hrUsers) {
            await prisma_1.default.inAppNotification.create({
                data: {
                    userId: hr.id,
                    title: 'Pengajuan Kontrak Baru',
                    message: `Karyawan ${submission.employee.name} mengajukan ${submissionType}: "${reason.substring(0, 50)}..."`,
                    link: '/submissions',
                },
            });
        }
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_SUBMISSION', 'SUBMISSION', `Created submission ${submission.id} for ${submission.employee.name}`, req.ip || '');
        return res.status(201).json({ message: 'Pengajuan berhasil dikirim.', submission });
    }
    catch (error) {
        console.error('Error creating submission:', error);
        return res.status(500).json({ error: 'Gagal membuat pengajuan.' });
    }
});
// PUT /api/submissions/:id/status
router.put('/:id/status', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { status, remarks } = req.body;
        if (!status || !['DIPROSES', 'DISETUJUI', 'DITOLAK'].includes(status)) {
            return res.status(400).json({ error: 'Status pengajuan tidak valid.' });
        }
        const existing = await prisma_1.default.submissionForm.findUnique({
            where: { id },
            include: { employee: true },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
        }
        const updated = await prisma_1.default.submissionForm.update({
            where: { id },
            data: {
                status,
                remarks: remarks || null,
                processedById: req.user?.id,
            },
            include: { employee: true },
        });
        const empUser = await prisma_1.default.user.findFirst({
            where: { employeeId: existing.employeeId },
        });
        if (empUser) {
            await prisma_1.default.inAppNotification.create({
                data: {
                    userId: empUser.id,
                    title: `Status Pengajuan: ${status}`,
                    message: `Pengajuan Anda (${existing.submissionType}) telah diubah menjadi: ${status}. Catatan: ${remarks || '-'}`,
                    link: '/submissions',
                },
            });
        }
        await (0, auditLogger_1.logAudit)(req.user?.id, 'PROCESS_SUBMISSION', 'SUBMISSION', `Set submission ${id} to ${status} for ${existing.employee.name}`, req.ip || '');
        return res.json({ message: `Status pengajuan berhasil diubah menjadi ${status}.`, submission: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memproses status pengajuan.' });
    }
});
exports.default = router;
