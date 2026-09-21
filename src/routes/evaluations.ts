import { Router, Request, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { Prisma } from '@prisma/client';
import {
  generateEvaluationToken,
  getEvaluationUrl,
  buildEvaluationWhatsAppUrl,
  sendEvaluationInviteEmail,
} from '../services/evaluationNotification';

const router = Router();

// Helper to compute score and recommendations based on Batara's official rules:
// - Nilai 2-2.75 = 3 bulan perpanjangan
// - Nilai 2.76-2.99 = 6 bulan perpanjangan
// - Nilai 3-4 = 12 bulan perpanjangan
// - Nilai < 2 = Selesai Kontrak / Tidak Lanjut
function calculateEvaluationScores(scores: Record<string, number>) {
  const values = Object.values(scores).filter((v) => typeof v === 'number' && v > 0);
  const totalScore = values.reduce((sum, v) => sum + v, 0);
  const count = values.length > 0 ? values.length : 1;
  const averageScore = Math.round((totalScore / count) * 100) / 100;

  let ratingGrade = 'MEMUASKAN';
  let recommendationType = 'LANJUT_KONTRAK';
  let recommendationDuration: number | null = 12;

  if (averageScore >= 3.0) {
    ratingGrade = 'MEMUASKAN';
    recommendationType = 'LANJUT_KONTRAK';
    recommendationDuration = 12;
  } else if (averageScore >= 2.76) {
    ratingGrade = 'CUKUP MEMUASKAN';
    recommendationType = 'LANJUT_KONTRAK';
    recommendationDuration = 6;
  } else if (averageScore >= 2.0) {
    ratingGrade = 'KURANG MEMUASKAN';
    recommendationType = 'SELESAI_KONTRAK';
    recommendationDuration = null;
  } else {
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
router.get('/', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, contractId, search } = req.query;

    const whereClause: Prisma.ContractEvaluationWhereInput = {};

    if (employeeId) {
      whereClause.employeeId = String(employeeId);
    }

    if (contractId) {
      whereClause.contractId = String(contractId);
    }

    if (search) {
      const q = String(search).trim();
      whereClause.OR = [
        { documentNumber: { contains: q, mode: 'insensitive' } },
        { employee: { name: { contains: q, mode: 'insensitive' } } },
        { employee: { nik: { contains: q, mode: 'insensitive' } } },
        { employee: { department: { contains: q, mode: 'insensitive' } } },
        { employee: { position: { contains: q, mode: 'insensitive' } } },
        { contract: { contractNumber: { contains: q, mode: 'insensitive' } } },
        { evaluatorName: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
        { ratingGrade: { contains: q, mode: 'insensitive' } },
        { recommendationType: { contains: q, mode: 'insensitive' } },
      ];
    }

    const evaluations = await prisma.contractEvaluation.findMany({
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
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    return res.status(500).json({ error: 'Gagal mengambil data penilaian kontrak.' });
  }
});

// GET /api/evaluations/contract/:contractId
router.get('/contract/:contractId', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const contractId = String(req.params.contractId);

    const evaluation = await prisma.contractEvaluation.findFirst({
      where: { contractId },
      include: {
        employee: true,
        contract: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ evaluation: evaluation || null });
  } catch (error) {
    console.error('Error fetching contract evaluation:', error);
    return res.status(500).json({ error: 'Gagal mengambil evaluasi kontrak.' });
  }
});

// GET /api/evaluations/:id
router.get('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const evaluation = await prisma.contractEvaluation.findUnique({
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
  } catch (error) {
    console.error('Error fetching evaluation by id:', error);
    return res.status(500).json({ error: 'Gagal mengambil detail penilaian.' });
  }
});

// POST /api/evaluations
router.post('/', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const {
      employeeId,
      contractId,
      documentNumber,
      periodEnd,
      employeeLevel,
      scores,
      statements,
      evaluatorName,
      evaluatorPosition,
      knownByName,
      knownByPosition,
      checkedByName,
      checkedByPosition,
      approvedByName,
      approvedByPosition,
      evaluationDate,
      submittedDate,
      notes,
      status,
      overrideRecommendationType,
      overrideRecommendationDuration,
    } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'Karyawan wajib dipilih.' });
    }

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    }

    const scoresObj = (typeof scores === 'object' && scores !== null) ? scores : {};
    const statementsObj = (typeof statements === 'object' && statements !== null) ? statements : {};

    const calc = calculateEvaluationScores(scoresObj);

    const finalRecommendationType = overrideRecommendationType || calc.recommendationType;
    const finalRecommendationDuration =
      overrideRecommendationDuration !== undefined
        ? (overrideRecommendationDuration ? Number(overrideRecommendationDuration) : null)
        : calc.recommendationDuration;

    // Generate document number if not provided: e.g. 339/BDP-HRGA-SITE/IX/2026
    const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    const now = new Date();
    const generatedDocNo =
      documentNumber ||
      `${Math.floor(Math.random() * 900 + 100)}/BDP-HRGA-SITE/${romanMonths[now.getMonth()]}/${now.getFullYear()}`;

    const evaluation = await prisma.contractEvaluation.create({
      data: {
        documentNumber: generatedDocNo,
        employeeId,
        contractId: contractId || null,
        periodEnd: periodEnd ? new Date(periodEnd) : null,
        employeeLevel: employeeLevel || employee.level || 'Worker',
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

    await logAudit(
      req.user?.id,
      'CREATE_EVALUATION',
      'CONTRACT_EVALUATION',
      `Created contract evaluation for ${employee.name} (Score: ${calc.averageScore}, Rec: ${finalRecommendationType} ${finalRecommendationDuration || ''} bln)`,
      req.ip || ''
    );

    return res.status(201).json({
      message: 'Form penilaian kontrak berhasil disimpan.',
      evaluation,
    });
  } catch (error) {
    console.error('Error creating evaluation:', error);
    return res.status(500).json({ error: 'Gagal menyimpan penilaian kontrak.' });
  }
});

// PUT /api/evaluations/:id
router.put('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.contractEvaluation.findUnique({ where: { id }, include: { employee: true } });

    if (!existing) {
      return res.status(404).json({ error: 'Data penilaian tidak ditemukan.' });
    }

    const {
      documentNumber,
      periodEnd,
      employeeLevel,
      scores,
      statements,
      evaluatorName,
      evaluatorPosition,
      knownByName,
      knownByPosition,
      checkedByName,
      checkedByPosition,
      approvedByName,
      approvedByPosition,
      evaluationDate,
      submittedDate,
      notes,
      status,
      overrideRecommendationType,
      overrideRecommendationDuration,
    } = req.body;

    const scoresObj = (typeof scores === 'object' && scores !== null) ? scores : JSON.parse(existing.scoresJson || '{}');
    const statementsObj = (typeof statements === 'object' && statements !== null) ? statements : JSON.parse(existing.statementsJson || '{}');

    const calc = calculateEvaluationScores(scoresObj);

    const finalRecommendationType = overrideRecommendationType || calc.recommendationType;
    const finalRecommendationDuration =
      overrideRecommendationDuration !== undefined
        ? (overrideRecommendationDuration ? Number(overrideRecommendationDuration) : null)
        : calc.recommendationDuration;

    const updated = await prisma.contractEvaluation.update({
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

    await logAudit(
      req.user?.id,
      'UPDATE_EVALUATION',
      'CONTRACT_EVALUATION',
      `Updated contract evaluation for ${existing.employee.name} (Score: ${calc.averageScore})`,
      req.ip || ''
    );

    return res.json({
      message: 'Penilaian kontrak berhasil diperbarui.',
      evaluation: updated,
    });
  } catch (error) {
    console.error('Error updating evaluation:', error);
    return res.status(500).json({ error: 'Gagal memperbarui penilaian kontrak.' });
  }
});

// DELETE /api/evaluations/:id
router.delete('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.contractEvaluation.findUnique({
      where: { id },
      include: { employee: { select: { name: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Data penilaian tidak ditemukan.' });
    }

    await prisma.contractEvaluation.delete({ where: { id } });

    await logAudit(
      req.user?.id,
      'DELETE_EVALUATION',
      'CONTRACT_EVALUATION',
      `Deleted contract evaluation ${existing.documentNumber || existing.id} for ${existing.employee?.name || ''}`,
      req.ip || ''
    );

    return res.json({ message: 'Data penilaian kontrak berhasil dihapus.' });
  } catch (error) {
    console.error('Error deleting evaluation:', error);
    return res.status(500).json({ error: 'Gagal menghapus penilaian kontrak.' });
  }
});

// POST /api/evaluations/send-link
router.post('/send-link', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const {
      employeeId,
      contractId,
      evaluatorName,
      evaluatorPosition,
      evaluatorEmail,
      evaluatorPhone,
      sendEmailNow,
      frontendBaseUrl,
    } = req.body;

    if (!employeeId) {
      return res.status(400).json({ error: 'Karyawan wajib dipilih.' });
    }
    if (!evaluatorName) {
      return res.status(400).json({ error: 'Nama atasan penilai wajib diisi.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        contracts: {
          orderBy: { sequence: 'desc' },
          take: 1,
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Data karyawan tidak ditemukan.' });
    }

    const activeContract = contractId
      ? await prisma.contract.findUnique({ where: { id: contractId } })
      : employee.contracts[0];

    // Check if there is an existing evaluation for this contract/employee
    let evaluation = await prisma.contractEvaluation.findFirst({
      where: {
        OR: [
          ...(activeContract ? [{ contractId: activeContract.id }] : []),
          { employeeId: employee.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    const token = generateEvaluationToken();
    const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const romanMonths = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    const now = new Date();
    const generatedDocNo = `${Math.floor(Math.random() * 900 + 100)}/BDP-HRGA-SITE/${romanMonths[now.getMonth()]}/${now.getFullYear()}`;

    if (evaluation && evaluation.status !== 'COMPLETED') {
      evaluation = await prisma.contractEvaluation.update({
        where: { id: evaluation.id },
        data: {
          evaluatorName,
          evaluatorPosition: evaluatorPosition || null,
          evaluatorEmail: evaluatorEmail || null,
          evaluatorPhone: evaluatorPhone || null,
          accessToken: token,
          tokenExpiresAt,
          status: 'WAITING_EVALUATION',
        },
        include: { employee: true, contract: true },
      });
    } else if (!evaluation) {
      evaluation = await prisma.contractEvaluation.create({
        data: {
          documentNumber: generatedDocNo,
          employeeId: employee.id,
          contractId: activeContract?.id || null,
          periodEnd: activeContract?.endDate || null,
          employeeLevel: employee.level || 'Worker',
          scoresJson: '{}',
          statementsJson: '{}',
          totalScore: 0,
          averageScore: 0,
          ratingGrade: '-',
          recommendationType: 'PENDING',
          recommendationDuration: null,
          evaluatorName,
          evaluatorPosition: evaluatorPosition || null,
          evaluatorEmail: evaluatorEmail || null,
          evaluatorPhone: evaluatorPhone || null,
          accessToken: token,
          tokenExpiresAt,
          status: 'WAITING_EVALUATION',
          createdById: req.user?.id || null,
        },
        include: { employee: true, contract: true },
      });
    } else {
      evaluation = await prisma.contractEvaluation.update({
        where: { id: evaluation.id },
        data: {
          accessToken: token,
          tokenExpiresAt,
          evaluatorName,
          evaluatorPosition: evaluatorPosition || evaluation.evaluatorPosition,
          evaluatorEmail: evaluatorEmail || evaluation.evaluatorEmail,
          evaluatorPhone: evaluatorPhone || evaluation.evaluatorPhone,
        },
        include: { employee: true, contract: true },
      });
    }

    const evaluationUrl = getEvaluationUrl(token, frontendBaseUrl);
    const whatsappUrl = buildEvaluationWhatsAppUrl(evaluatorPhone, {
      evaluatorName,
      evaluatorPosition,
      evaluatorEmail,
      evaluatorPhone,
      employeeName: employee.name,
      employeeNik: employee.nik,
      department: employee.department,
      position: employee.position,
      endDate: activeContract?.endDate || new Date(),
      accessToken: token,
      frontendBaseUrl,
    });

    let emailSent = false;
    let emailError: string | undefined;

    if (sendEmailNow && evaluatorEmail) {
      const emailRes = await sendEvaluationInviteEmail({
        evaluatorName,
        evaluatorPosition,
        evaluatorEmail,
        evaluatorPhone,
        employeeName: employee.name,
        employeeNik: employee.nik,
        department: employee.department,
        position: employee.position,
        endDate: activeContract?.endDate || new Date(),
        accessToken: token,
        frontendBaseUrl,
      });
      emailSent = emailRes.ok;
      if (!emailRes.ok) emailError = emailRes.error;
    }

    await logAudit(
      req.user?.id,
      'SEND_EVALUATION_LINK',
      'CONTRACT_EVALUATION',
      `Sent evaluation link for ${employee.name} to ${evaluatorName} (${evaluatorEmail || evaluatorPhone || 'link'})`,
      req.ip || ''
    );

    return res.json({
      message: 'Link formulir evaluasi berhasil dibuat.',
      evaluation,
      evaluationUrl,
      whatsappUrl,
      emailSent,
      emailError,
    });
  } catch (error) {
    console.error('Error sending evaluation link:', error);
    return res.status(500).json({ error: 'Gagal membuat dan mengirimkan tautan evaluasi.' });
  }
});

// GET /api/evaluations/public/:token
router.get('/public/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token).trim();
    if (!token) {
      return res.status(400).json({ error: 'Token tidak valid.' });
    }

    const evaluation = await prisma.contractEvaluation.findUnique({
      where: { accessToken: token },
      include: {
        employee: {
          select: {
            id: true,
            nik: true,
            name: true,
            department: true,
            position: true,
            level: true,
            joinDate: true,
          },
        },
        contract: {
          select: {
            id: true,
            contractNumber: true,
            sequence: true,
            startDate: true,
            endDate: true,
            contractType: true,
          },
        },
      },
    });

    if (!evaluation) {
      return res.status(404).json({ error: 'Formulir evaluasi tidak ditemukan atau tautan sudah tidak berlaku.' });
    }

    if (evaluation.tokenExpiresAt && new Date() > evaluation.tokenExpiresAt) {
      return res.status(410).json({
        error: 'Masa berlaku tautan evaluasi ini telah kedaluwarsa. Silakan hubungi tim HRD untuk meminta tautan baru.',
      });
    }

    return res.json({
      evaluation,
      isCompleted: evaluation.status === 'COMPLETED',
    });
  } catch (error) {
    console.error('Error loading public evaluation:', error);
    return res.status(500).json({ error: 'Gagal memuat formulir evaluasi.' });
  }
});

// POST /api/evaluations/public/:token/submit
router.post('/public/:token/submit', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token).trim();
    const {
      scores,
      statements,
      evaluatorName,
      evaluatorPosition,
      notes,
    } = req.body;

    const evaluation = await prisma.contractEvaluation.findUnique({
      where: { accessToken: token },
      include: { employee: true, contract: true },
    });

    if (!evaluation) {
      return res.status(404).json({ error: 'Formulir evaluasi tidak ditemukan.' });
    }

    if (evaluation.tokenExpiresAt && new Date() > evaluation.tokenExpiresAt) {
      return res.status(410).json({ error: 'Tautan evaluasi telah kedaluwarsa.' });
    }

    const scoresObj = (typeof scores === 'object' && scores !== null) ? scores : {};
    const statementsObj = (typeof statements === 'object' && statements !== null) ? statements : {};

    const calc = calculateEvaluationScores(scoresObj);

    const updated = await prisma.contractEvaluation.update({
      where: { id: evaluation.id },
      data: {
        scoresJson: JSON.stringify(scoresObj),
        statementsJson: JSON.stringify(statementsObj),
        totalScore: calc.totalScore,
        averageScore: calc.averageScore,
        ratingGrade: calc.ratingGrade,
        recommendationType: calc.recommendationType,
        recommendationDuration: calc.recommendationDuration,
        evaluatorName: evaluatorName || evaluation.evaluatorName,
        evaluatorPosition: evaluatorPosition || evaluation.evaluatorPosition,
        notes: notes || evaluation.notes,
        status: 'COMPLETED',
        submittedDate: new Date(),
        evaluationDate: new Date(),
      },
      include: {
        employee: true,
        contract: true,
      },
    });

    await logAudit(
      null,
      'EVALUATION_SUBMITTED_BY_SUPERVISOR',
      'CONTRACT_EVALUATION',
      `Evaluation submitted online for ${evaluation.employee.name} by ${updated.evaluatorName || 'Supervisor'} (Score: ${calc.averageScore}, Rec: ${calc.recommendationDuration} Bln)`,
      req.ip || ''
    );

    return res.json({
      message: 'Penilaian kinerja berhasil disimpan ke sistem HRIS.',
      evaluation: updated,
    });
  } catch (error) {
    console.error('Error submitting public evaluation:', error);
    return res.status(500).json({ error: 'Gagal mengirimkan penilaian kinerja.' });
  }
});

export default router;
