"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const auditLogger_1 = require("../utils/auditLogger");
const upload_1 = require("../utils/upload");
const router = (0, express_1.Router)();
// GET /api/contracts
router.get('/', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { status, contractType, search } = req.query;
        const whereClause = {};
        if (req.user?.role === 'USER') {
            if (!req.user.employeeId) {
                return res.json({ contracts: [], total: 0 });
            }
            whereClause.employeeId = req.user.employeeId;
        }
        else {
            if (status) {
                whereClause.status = status;
            }
            if (contractType) {
                whereClause.contractType = contractType;
            }
            if (search) {
                whereClause.OR = [
                    { contractNumber: { contains: String(search), mode: 'insensitive' } },
                    { employee: { name: { contains: String(search), mode: 'insensitive' } } },
                    { employee: { nik: { contains: String(search), mode: 'insensitive' } } },
                ];
            }
        }
        const contracts = await prisma_1.default.contract.findMany({
            where: whereClause,
            include: {
                employee: true,
                createdBy: {
                    select: { id: true, name: true, email: true },
                },
            },
            orderBy: { endDate: 'asc' },
        });
        return res.json({ contracts, total: contracts.length });
    }
    catch (error) {
        console.error('Error fetching contracts:', error);
        return res.status(500).json({ error: 'Gagal mengambil data kontrak.' });
    }
});
// GET /api/contracts/:id
router.get('/:id', auth_1.authenticateJWT, async (req, res) => {
    try {
        const id = String(req.params.id);
        const contract = await prisma_1.default.contract.findUnique({
            where: { id },
            include: {
                employee: true,
                createdBy: { select: { id: true, name: true } },
                history: {
                    include: {
                        changedBy: { select: { id: true, name: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!contract) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
        }
        if (req.user?.role === 'USER' && req.user.employeeId !== contract.employeeId) {
            return res.status(403).json({ error: 'Akses ditolak.' });
        }
        return res.json(contract);
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil detail kontrak.' });
    }
});
// POST /api/contracts
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { employeeId, contractNumber, contractType, startDate, endDate, notes, documentUrl } = req.body;
        if (!employeeId || !contractNumber || !contractType || !startDate || !endDate) {
            return res.status(400).json({ error: 'Field wajib: Karyawan, No Kontrak, Jenis Kontrak, Tanggal Mulai, Tanggal Berakhir.' });
        }
        const existingNumber = await prisma_1.default.contract.findUnique({ where: { contractNumber } });
        if (existingNumber) {
            return res.status(400).json({ error: `Nomor kontrak '${contractNumber}' sudah terdaftar.` });
        }
        const start = new Date(startDate);
        const end = new Date(endDate);
        const today = new Date();
        let initialStatus = 'AKTIF';
        const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 3600 * 24));
        if (diffDays <= 0) {
            initialStatus = 'EXPIRED';
        }
        else if (diffDays <= 30) {
            initialStatus = 'AKAN_BERAKHIR';
        }
        if (contractType === 'PKWTT') {
            initialStatus = 'DIANGKAT_TETAP';
        }
        const contract = await prisma_1.default.contract.create({
            data: {
                employeeId,
                contractNumber,
                contractType,
                startDate: start,
                endDate: end,
                status: initialStatus,
                notes: notes || null,
                documentUrl: documentUrl || null,
                createdById: req.user?.id || null,
            },
            include: {
                employee: true,
            },
        });
        await prisma_1.default.contractHistory.create({
            data: {
                contractId: contract.id,
                changeType: 'INITIAL_CREATION',
                newData: JSON.stringify(contract),
                changedById: req.user?.id || null,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_CONTRACT', 'CONTRACT', `Created contract ${contract.contractNumber} for ${contract.employee.name}`, req.ip || '');
        return res.status(201).json({ message: 'Kontrak berhasil dibuat.', contract });
    }
    catch (error) {
        console.error('Error creating contract:', error);
        return res.status(500).json({ error: 'Gagal membuat data kontrak.' });
    }
});
// POST /api/contracts/:id/extend
router.post('/:id/extend', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { newContractNumber, newContractType, newStartDate, newEndDate, actionType, notes } = req.body;
        const oldContract = await prisma_1.default.contract.findUnique({
            where: { id },
            include: { employee: true },
        });
        if (!oldContract) {
            return res.status(404).json({ error: 'Kontrak lama tidak ditemukan.' });
        }
        if (actionType === 'ANGKAT_TETAP') {
            const updatedContract = await prisma_1.default.contract.update({
                where: { id },
                data: {
                    status: 'DIANGKAT_TETAP',
                    contractType: 'PKWTT',
                    notes: notes ? `${oldContract.notes || ''} | Diangkat Tetap: ${notes}` : oldContract.notes,
                },
                include: { employee: true },
            });
            await prisma_1.default.employee.update({
                where: { id: oldContract.employeeId },
                data: { employmentType: 'PKWTT' },
            });
            await prisma_1.default.contractHistory.create({
                data: {
                    contractId: oldContract.id,
                    changeType: 'CONVERT_TO_PERMANENT',
                    previousData: JSON.stringify({ status: oldContract.status, type: oldContract.contractType }),
                    newData: JSON.stringify({ status: 'DIANGKAT_TETAP', type: 'PKWTT' }),
                    changedById: req.user?.id,
                },
            });
            await (0, auditLogger_1.logAudit)(req.user?.id, 'CONVERT_PERMANENT', 'CONTRACT', `Converted ${oldContract.employee.name} to Permanent (PKWTT)`, req.ip || '');
            return res.json({ message: 'Status karyawan berhasil diubah menjadi Karyawan Tetap (PKWTT).', contract: updatedContract });
        }
        if (!newContractNumber || !newStartDate || !newEndDate) {
            return res.status(400).json({ error: 'Field wajib: Nomor Kontrak Baru, Tanggal Mulai Baru, Tanggal Berakhir Baru.' });
        }
        await prisma_1.default.contract.update({
            where: { id },
            data: { status: 'DIPERPANJANG' },
        });
        const newContract = await prisma_1.default.contract.create({
            data: {
                employeeId: oldContract.employeeId,
                contractNumber: newContractNumber,
                contractType: newContractType || oldContract.contractType,
                startDate: new Date(newStartDate),
                endDate: new Date(newEndDate),
                status: 'AKTIF',
                notes: notes || `Perpanjangan dari kontrak ${oldContract.contractNumber}`,
                createdById: req.user?.id,
            },
            include: { employee: true },
        });
        await prisma_1.default.contractHistory.create({
            data: {
                contractId: newContract.id,
                changeType: 'EXTEND_CONTRACT',
                previousData: JSON.stringify({ oldContractId: oldContract.id, oldContractNumber: oldContract.contractNumber }),
                newData: JSON.stringify(newContract),
                changedById: req.user?.id,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'EXTEND_CONTRACT', 'CONTRACT', `Extended contract for ${oldContract.employee.name} (New No: ${newContractNumber})`, req.ip || '');
        return res.status(201).json({ message: 'Kontrak berhasil diperpanjang.', contract: newContract });
    }
    catch (error) {
        console.error('Error extending contract:', error);
        return res.status(500).json({ error: 'Gagal memproses perpanjangan kontrak.' });
    }
});
// POST /api/contracts/:id/upload-document
router.post('/:id/upload-document', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), upload_1.uploadContractDocument.single('document'), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.contract.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'File dokumen wajib diunggah (field: document).' });
        }
        const documentUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        const updated = await prisma_1.default.contract.update({
            where: { id },
            data: { documentUrl },
        });
        await prisma_1.default.contractHistory.create({
            data: {
                contractId: id,
                changeType: 'UPLOAD_DOCUMENT',
                previousData: existing.documentUrl ? JSON.stringify({ documentUrl: existing.documentUrl }) : null,
                newData: JSON.stringify({ documentUrl }),
                changedById: req.user?.id,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPLOAD_CONTRACT_DOCUMENT', 'CONTRACT', `Uploaded document for contract ${existing.contractNumber}`, req.ip || '');
        return res.json({ message: 'Dokumen kontrak berhasil diunggah.', documentUrl });
    }
    catch (error) {
        if (error?.message?.includes('Tipe file')) {
            return res.status(400).json({ error: error.message });
        }
        console.error('Error uploading contract document:', error);
        return res.status(500).json({ error: 'Gagal mengunggah dokumen kontrak.' });
    }
});
// PUT /api/contracts/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { contractType, startDate, endDate, status, notes, documentUrl } = req.body;
        const existing = await prisma_1.default.contract.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
        }
        const updated = await prisma_1.default.contract.update({
            where: { id },
            data: {
                contractType: contractType || existing.contractType,
                startDate: startDate ? new Date(startDate) : existing.startDate,
                endDate: endDate ? new Date(endDate) : existing.endDate,
                status: status || existing.status,
                notes: notes !== undefined ? notes : existing.notes,
                documentUrl: documentUrl !== undefined ? documentUrl : existing.documentUrl,
            },
        });
        await prisma_1.default.contractHistory.create({
            data: {
                contractId: id,
                changeType: 'UPDATE_DETAILS',
                previousData: JSON.stringify(existing),
                newData: JSON.stringify(updated),
                changedById: req.user?.id,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_CONTRACT', 'CONTRACT', `Updated contract ${existing.contractNumber}`, req.ip || '');
        return res.json({ message: 'Data kontrak berhasil diperbarui.', contract: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui kontrak.' });
    }
});
// DELETE /api/contracts/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.contract.findUnique({
            where: { id },
            include: { employee: { select: { name: true } } },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
        }
        await prisma_1.default.contract.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_CONTRACT', 'CONTRACT', `Deleted contract ${existing.contractNumber} for ${existing.employee?.name || ''}`, req.ip || '');
        return res.json({ message: 'Kontrak berhasil dihapus.' });
    }
    catch (error) {
        console.error('Error deleting contract:', error);
        return res.status(500).json({ error: 'Gagal menghapus kontrak.' });
    }
});
exports.default = router;
