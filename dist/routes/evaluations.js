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
// Helper to compute score and recommendations based on Batara's official rules:
// - Nilai 2-2.75 = 3 bulan perpanjangan
// - Nilai 2.76-2.99 = 6 bulan perpanjangan
// - Nilai 3-4 = 12 bulan perpanjangan
// - Nilai < 2 = Selesai Kontrak / Tidak Lanjut
function calculateEvaluationScores(scores) {
    const values = Object.values(scores).filter((v) => typeof v === 'number' && v > 0);
    const totalScore = values.reduce((sum, v) => sum + v, 0);
    const count = values.length > 0 ? values.length : 1;
    const averageScore = Math.round((totalScore / count) * 100) / 100;
    let ratingGrade = 'MEMUASKAN';
    let recommendationType = 'LANJUT_KONTRAK';
    let recommendationDuration = 12;
    if (averageScore >= 3.0) {
        ratingGrade = 'MEMUASKAN';
        recommendationType = 'LANJUT_KONTRAK';
        recommendationDuration = 12;
    }
    else if (averageScore >= 2.76) {
        ratingGrade = 'CUKUP MEMUASKAN';
        recommendationType = 'LANJUT_KONTRAK';
        recommendationDuration = 6;
    }
    else if (averageScore >= 2.0) {
        ratingGrade = 'KURANG MEMUASKAN';
        recommendationType = 'LANJUT_KONTRAK';
        recommendationDuration = 3;
    }
    else {
        ratingGrade = 'TIDAK MEMUASKAN';
        recommendationType = 'SELESAI_KONTRAK';
        recommendationDuration = null;
    }
    return {
        totalScore,
        averageScore,
        ratingGrade,
        recommendationType,
        recommendationDuration,
    };
}
// GET /api/evaluations
router.get('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { employeeId, contractId, search } = req.query;
        const whereClause = {};
        if (employeeId) {
            whereClause.employeeId = String(employeeId);
        }
        if (contractId) {
            whereClause.contractId = String(contractId);
        }
        if (search) {
            const q = String(search);
            whereClause.OR = [
                { documentNumber: { contains: q, mode: 'insensitive' } },
                { employee: { name: { contains: q, mode: 'insensitive' } } },
                { employee: { nik: { contains: q, mode: 'insensitive' } } },
                { employee: { department: { contains: q, mode: 'insensitive' } } },
            ];
        }
        const evaluations = await prisma_1.default.contractEvaluation.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: {
                        id: true,
                        nik: true,
                        name: true,
                        department: true,
                        position: true,
                        level: true,
                    },
                },
                contract: {
                    select: {
                        id: true,
                        contractNumber: true,
                        sequence: true,
                        startDate: true,
                        endDate: true,
                        status: true,
                    },
                },
                createdBy: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({ evaluations, total: evaluations.length });
    }
    catch (error) {
        console.error('Error fetching evaluations:', error);
        return res.status(500).json({ error: 'Gagal mengambil data penilaian kontrak.' });
    }
});
// GET /api/evaluations/contract/:contractId
router.get('/contract/:contractId', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const contractId = String(req.params.contractId);
        const evaluation = await prisma_1.default.contractEvaluation.findFirst({
            where: { contractId },
            include: {
                employee: true,
                contract: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json({ evaluation: evaluation || null });
    }
    catch (error) {
        console.error('Error fetching contract evaluation:', error);
        return res.status(500).json({ error: 'Gagal mengambil evaluasi kontrak.' });
    }
});
// GET /api/evaluations/:id
router.get('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const evaluation = await prisma_1.default.contractEvaluation.findUnique({
            where: { id },
            include: {
                employee: true,
                contract: true,
                createdBy: { select: { id: true, name: true } },
            },
        });
        if (!evaluation) {
            return res.status(404).json({ error: 'Data penilaian tidak ditemukan.' });
        }
        return res.json({ evaluation });
    }
    catch (error) {
        console.error('Error fetching evaluation by id:', error);
        return res.status(500).json({ error: 'Gagal mengambil detail penilaian.' });
    }
});
// POST /api/evaluations
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { employeeId, contractId, documentNumber, periodEnd, employeeLevel, scores, statements, evaluatorName, evaluatorPosition, knownByName, knownByPosition, checkedByName, checkedByPosition, approvedByName, approvedByPosition, evaluationDate, submittedDate, notes, status, overrideRecommendationType, overrideRecommendationDuration, } = req.body;
        if (!employeeId) {
            return res.status(400).json({ error: 'Karyawan wajib dipilih.' });
        }
        const employee = await prisma_1.default.employee.findUnique({ where: { id: employeeId } });
        if (!employee) {
            return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        }
        const scoresObj = (typeof scores === 'object' && scores !== null) ? scores : {};
        const statementsObj = (typeof statements === 'object' && statements !== null) ? statements : {};
        const calc = calculateEvaluationScores(scoresObj);
        const finalRecommendationType = overrideRecommendationType || calc.recommendationType;
        const finalRecommendationDuration = overrideRecommendationDuration !== undefined
            ? (overrideRecommendationDuration ? Number(overrideRecommendationDuration) : null)
            : calc.recommendationDuration;
        // Generate document number if not provided: e.g. 339/BDP-HRGA-SITE/IX/2026
        const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
        const now = new Date();
        const generatedDocNo = documentNumber ||
            `${Math.floor(Math.random() * 900 + 100)}/BDP-HRGA-SITE/${romanMonths[now.getMonth()]}/${now.getFullYear()}`;
        const evaluation = await prisma_1.default.contractEvaluation.create({
            data: {
                documentNumber: generatedDocNo,
                employeeId,
                contractId: contractId || null,
                periodEnd: periodEnd ? new Date(periodEnd) : null,
                employeeLevel: employeeLevel || employee.level || 'Non-Staff',
                scoresJson: JSON.stringify(scoresObj),
                statementsJson: JSON.stringify(statementsObj),
                totalScore: calc.totalScore,
                averageScore: calc.averageScore,
                ratingGrade: calc.ratingGrade,
                recommendationType: finalRecommendationType,
                recommendationDuration: finalRecommendationDuration,
                evaluatorName: evaluatorName || null,
                evaluatorPosition: evaluatorPosition || null,
                knownByName: knownByName || null,
                knownByPosition: knownByPosition || null,
                checkedByName: checkedByName || 'A. Pallawa Rukka Rizal',
                checkedByPosition: checkedByPosition || 'Spv HRGA',
                approvedByName: approvedByName || 'Anggi Okta Yudha Perkasa',
                approvedByPosition: approvedByPosition || 'Project Manager',
                evaluationDate: evaluationDate ? new Date(evaluationDate) : new Date(),
                submittedDate: submittedDate ? new Date(submittedDate) : new Date(),
                notes: notes || null,
                status: status || 'COMPLETED',
                createdById: req.user?.id || null,
            },
            include: {
                employee: true,
                contract: true,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_EVALUATION', 'CONTRACT_EVALUATION', `Created contract evaluation for ${employee.name} (Score: ${calc.averageScore}, Rec: ${finalRecommendationType} ${finalRecommendationDuration || ''} bln)`, req.ip || '');
        return res.status(201).json({
            message: 'Form penilaian kontrak berhasil disimpan.',
            evaluation,
        });
    }
    catch (error) {
        console.error('Error creating evaluation:', error);
        return res.status(500).json({ error: 'Gagal menyimpan penilaian kontrak.' });
    }
});
// PUT /api/evaluations/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.contractEvaluation.findUnique({ where: { id }, include: { employee: true } });
        if (!existing) {
            return res.status(404).json({ error: 'Data penilaian tidak ditemukan.' });
        }
        const { documentNumber, periodEnd, employeeLevel, scores, statements, evaluatorName, evaluatorPosition, knownByName, knownByPosition, checkedByName, checkedByPosition, approvedByName, approvedByPosition, evaluationDate, submittedDate, notes, status, overrideRecommendationType, overrideRecommendationDuration, } = req.body;
        const scoresObj = (typeof scores === 'object' && scores !== null) ? scores : JSON.parse(existing.scoresJson || '{}');
        const statementsObj = (typeof statements === 'object' && statements !== null) ? statements : JSON.parse(existing.statementsJson || '{}');
        const calc = calculateEvaluationScores(scoresObj);
        const finalRecommendationType = overrideRecommendationType || calc.recommendationType;
        const finalRecommendationDuration = overrideRecommendationDuration !== undefined
            ? (overrideRecommendationDuration ? Number(overrideRecommendationDuration) : null)
            : calc.recommendationDuration;
        const updated = await prisma_1.default.contractEvaluation.update({
            where: { id },
            data: {
                documentNumber: documentNumber !== undefined ? documentNumber : existing.documentNumber,
                periodEnd: periodEnd ? new Date(periodEnd) : existing.periodEnd,
                employeeLevel: employeeLevel !== undefined ? employeeLevel : existing.employeeLevel,
                scoresJson: JSON.stringify(scoresObj),
                statementsJson: JSON.stringify(statementsObj),
                totalScore: calc.totalScore,
                averageScore: calc.averageScore,
                ratingGrade: calc.ratingGrade,
                recommendationType: finalRecommendationType,
                recommendationDuration: finalRecommendationDuration,
                evaluatorName: evaluatorName !== undefined ? evaluatorName : existing.evaluatorName,
                evaluatorPosition: evaluatorPosition !== undefined ? evaluatorPosition : existing.evaluatorPosition,
                knownByName: knownByName !== undefined ? knownByName : existing.knownByName,
                knownByPosition: knownByPosition !== undefined ? knownByPosition : existing.knownByPosition,
                checkedByName: checkedByName !== undefined ? checkedByName : existing.checkedByName,
                checkedByPosition: checkedByPosition !== undefined ? checkedByPosition : existing.checkedByPosition,
                approvedByName: approvedByName !== undefined ? approvedByName : existing.approvedByName,
                approvedByPosition: approvedByPosition !== undefined ? approvedByPosition : existing.approvedByPosition,
                evaluationDate: evaluationDate ? new Date(evaluationDate) : existing.evaluationDate,
                submittedDate: submittedDate ? new Date(submittedDate) : existing.submittedDate,
                notes: notes !== undefined ? notes : existing.notes,
                status: status !== undefined ? status : existing.status,
            },
            include: {
                employee: true,
                contract: true,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_EVALUATION', 'CONTRACT_EVALUATION', `Updated contract evaluation for ${existing.employee.name} (Score: ${calc.averageScore})`, req.ip || '');
        return res.json({
            message: 'Penilaian kontrak berhasil diperbarui.',
            evaluation: updated,
        });
    }
    catch (error) {
        console.error('Error updating evaluation:', error);
        return res.status(500).json({ error: 'Gagal memperbarui penilaian kontrak.' });
    }
});
// DELETE /api/evaluations/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.contractEvaluation.findUnique({ where: { id }, include: { employee: true } });
        if (!existing) {
            return res.status(404).json({ error: 'Data penilaian tidak ditemukan.' });
        }
        await prisma_1.default.contractEvaluation.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_EVALUATION', 'CONTRACT_EVALUATION', `Deleted evaluation for ${existing.employee.name}`, req.ip || '');
        return res.json({ message: 'Data penilaian berhasil dihapus.' });
    }
    catch (error) {
        console.error('Error deleting evaluation:', error);
        return res.status(500).json({ error: 'Gagal menghapus penilaian kontrak.' });
    }
});
exports.default = router;
