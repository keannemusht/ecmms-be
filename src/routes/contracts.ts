import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { uploadContractDocument } from '../utils/upload';
import { buildWhatsAppLink, buildWhatsAppMessage } from '../services/whatsappNotification';
import { Prisma, ContractStatus, EmploymentType } from '@prisma/client';
import { normalizeEmployeeContractStatuses } from '../services/contractNormalizer';

const router = Router();

// GET /api/contracts
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { status, contractType, search, dateType, dateFrom, dateTo, sortBy, sortOrder } = req.query;

    const whereClause: Prisma.ContractWhereInput = {};

    if (req.user?.role === 'USER') {
      if (!req.user.employeeId) {
        return res.json({ contracts: [], total: 0 });
      }
      whereClause.employeeId = req.user.employeeId;
    } else {
      if (status) {
        whereClause.status = status as ContractStatus;
      }
      if (contractType) {
        whereClause.contractType = contractType as EmploymentType;
      }
      if (search) {
        whereClause.OR = [
          { contractNumber: { contains: String(search), mode: 'insensitive' } },
          { employee: { name: { contains: String(search), mode: 'insensitive' } } },
          { employee: { nik: { contains: String(search), mode: 'insensitive' } } },
        ];
      }
      if (dateFrom || dateTo) {
        const field = dateType === 'startDate' ? 'startDate' : 'endDate';
        const dateFilter: Prisma.DateTimeFilter = {};
        if (dateFrom) {
          dateFilter.gte = new Date(String(dateFrom) + 'T00:00:00.000Z');
        }
        if (dateTo) {
          dateFilter.lte = new Date(String(dateTo) + 'T23:59:59.999Z');
        }
        whereClause[field] = dateFilter;
      }
    }

    const orderDir: Prisma.SortOrder = sortOrder === 'desc' ? 'desc' : 'asc';
    let orderByClause: Prisma.ContractOrderByWithRelationInput = { employee: { name: orderDir } };
    if (sortBy === 'endDate') {
      orderByClause = { endDate: orderDir };
    } else if (sortBy === 'startDate') {
      orderByClause = { startDate: orderDir };
    } else if (sortBy === 'contractNumber') {
      orderByClause = { contractNumber: orderDir };
    } else if (sortBy === 'sequence') {
      orderByClause = { sequence: orderDir };
    } else if (sortBy === 'employeeName') {
      orderByClause = { employee: { name: orderDir } };
    } else if (sortBy === 'status') {
      orderByClause = { status: orderDir };
    }

    const contracts = await prisma.contract.findMany({
      where: whereClause,
      include: {
        employee: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: orderByClause,
    });

    return res.json({ contracts, total: contracts.length });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return res.status(500).json({ error: 'Gagal mengambil data kontrak.' });
  }
});

// POST /api/contracts/:id/send-whatsapp — build wa.me link for the contract's employee
router.post('/:id/send-whatsapp', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!contract) {
      return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
    }

    const phone = contract.employee?.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Karyawan ini belum memiliki nomor telepon.' });
    }

    const waMessage = buildWhatsAppMessage({
      title: 'Informasi Kontrak',
      heading: `Kontrak ${contract.contractNumber}`,
      message: `Detail kontrak ${contract.employee.name}: berakhir pada ${new Date(contract.endDate).toISOString().split('T')[0]}. Mohon tinjau dan tindak lanjuti segera.`,
      contract,
      footerText: 'Pesan ini dikirim melalui sistem monitoring kontrak PKWT.',
    });

    const link = buildWhatsAppLink(phone, waMessage);
    if (!link) {
      return res.status(400).json({ error: 'Nomor WhatsApp karyawan tidak valid.' });
    }

    await prisma.notificationLog.create({
      data: {
        contractId: id,
        recipient: phone,
        channel: 'WHATSAPP',
        status: 'SENT',
        message: link,
      },
    });

    await logAudit(req.user?.id, 'SEND_WHATSAPP', 'CONTRACT', `WhatsApp link dibuka untuk ${contract.employee.name} (${phone})`, req.ip || '');

    return res.json({ link, phone });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat link WhatsApp.' });
  }
});

// GET /api/contracts/:id
router.get('/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const contract = await prisma.contract.findUnique({
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
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil detail kontrak.' });
  }
});

// POST /api/contracts
router.post('/', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { employeeId, contractNumber, contractType, startDate, endDate, notes, documentUrl } = req.body;

    if (!employeeId || !contractType || !startDate || !endDate) {
      return res.status(400).json({ error: 'Field wajib: Karyawan, Jenis Kontrak, Tanggal Mulai, Tanggal Berakhir.' });
    }

    const cleanContractNumber = contractNumber && String(contractNumber).trim() !== '' ? String(contractNumber).trim() : null;

    if (cleanContractNumber) {
      const existingNumber = await prisma.contract.findFirst({ where: { contractNumber: cleanContractNumber } });
      if (existingNumber) {
        return res.status(400).json({ error: `Nomor kontrak '${cleanContractNumber}' sudah terdaftar.` });
      }
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();

    let initialStatus: ContractStatus = 'AKTIF';
    const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 3600 * 24));

    if (diffDays <= 0) {
      initialStatus = 'EXPIRED';
    } else if (diffDays <= 30) {
      initialStatus = 'AKAN_BERAKHIR';
    }

    if (contractType === 'PKWTT') {
      initialStatus = 'AKTIF';
    }

    const contract = await prisma.contract.create({
      data: {
        employeeId,
        contractNumber: cleanContractNumber,
        contractType,
        sequence: (await prisma.contract.count({ where: { employeeId } })) + 1,
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

    // Normalize contract statuses for this employee so superseded contracts become DIPERPANJANG
    await normalizeEmployeeContractStatuses(employeeId);

    await prisma.contractHistory.create({
      data: {
        contractId: contract.id,
        changeType: 'INITIAL_CREATION',
        newData: JSON.stringify(contract),
        changedById: req.user?.id || null,
      },
    });

    await logAudit(req.user?.id, 'CREATE_CONTRACT', 'CONTRACT', `Created contract ${contract.contractNumber} for ${contract.employee.name}`, req.ip || '');

    return res.status(201).json({ message: 'Kontrak berhasil dibuat.', contract });
  } catch (error) {
    console.error('Error creating contract:', error);
    return res.status(500).json({ error: 'Gagal membuat data kontrak.' });
  }
});

// POST /api/contracts/:id/extend
router.post('/:id/extend', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { newContractNumber, newContractType, newStartDate, newEndDate, actionType, notes } = req.body;

    const oldContract = await prisma.contract.findUnique({
      where: { id },
      include: { employee: true },
    });

    if (!oldContract) {
      return res.status(404).json({ error: 'Kontrak lama tidak ditemukan.' });
    }

    // 1. Pastikan tindak lanjut hanya dilakukan pada kontrak terbaru karyawan
    const newerContract = await prisma.contract.findFirst({
      where: {
        employeeId: oldContract.employeeId,
        sequence: { gt: oldContract.sequence },
      },
    });

    if (newerContract) {
      return res.status(400).json({
        error: `Tindak lanjut hanya dapat diproses pada kontrak terbaru karyawan (Kontrak Ke-${newerContract.sequence}).`,
      });
    }

    // 2. Pastikan form penilaian kontrak atas nama karyawan tersebut sudah ada
    const evaluation = await prisma.contractEvaluation.findFirst({
      where: {
        OR: [
          { contractId: oldContract.id },
          { employeeId: oldContract.employeeId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!evaluation) {
      return res.status(400).json({
        error: 'Tindak lanjut terkunci: Karyawan belum memiliki form penilaian kontrak. Harap lengkapi form penilaian terlebih dahulu.',
      });
    }

    if (actionType === 'ANGKAT_TETAP') {
      const updatedContract = await prisma.contract.update({
        where: { id },
        data: {
          status: 'AKTIF',
          contractType: 'PKWTT',
          notes: notes ? `${oldContract.notes || ''} | Diangkat Tetap: ${notes}` : oldContract.notes,
        },
        include: { employee: true },
      });

      await prisma.employee.update({
        where: { id: oldContract.employeeId },
        data: { employmentType: 'PKWTT' },
      });

      await prisma.contractHistory.create({
        data: {
          contractId: oldContract.id,
          changeType: 'CONVERT_TO_PERMANENT',
          previousData: JSON.stringify({ status: oldContract.status, type: oldContract.contractType }),
          newData: JSON.stringify({ status: 'AKTIF', type: 'PKWTT' }),
          changedById: req.user?.id,
        },
      });

      await logAudit(req.user?.id, 'CONVERT_PERMANENT', 'CONTRACT', `Converted ${oldContract.employee.name} to Permanent (PKWTT)`, req.ip || '');

      return res.json({ message: 'Status karyawan berhasil diubah menjadi Karyawan Tetap (PKWTT).', contract: updatedContract });
    }

    if (actionType === 'RESIGN' || actionType === 'SELESAI_KONTRAK') {
      const updatedContract = await prisma.contract.update({
        where: { id },
        data: {
          status: 'RESIGN',
          notes: notes ? `${oldContract.notes || ''} | Resign/Selesai Kontrak: ${notes}` : `${oldContract.notes || ''} | Selesai Kontrak / Resign`,
        },
        include: { employee: true },
      });

      await prisma.contractHistory.create({
        data: {
          contractId: oldContract.id,
          changeType: 'CONTRACT_TERMINATED',
          previousData: JSON.stringify({ status: oldContract.status }),
          newData: JSON.stringify({ status: 'RESIGN', reason: notes || 'Selesai Kontrak / Resign' }),
          changedById: req.user?.id,
        },
      });

      await logAudit(req.user?.id, 'CONTRACT_RESIGN', 'CONTRACT', `Marked ${oldContract.employee.name} as Resign / Selesai Kontrak`, req.ip || '');

      return res.json({ message: 'Kontrak karyawan berhasil diubah menjadi Selesai Kontrak / Resign.', contract: updatedContract });
    }

    if (!newStartDate || !newEndDate) {
      return res.status(400).json({ error: 'Field wajib: Tanggal Mulai Baru, Tanggal Berakhir Baru.' });
    }

    const effectiveContractNumber = newContractNumber && String(newContractNumber).trim() !== '' ? String(newContractNumber).trim() : null;

    if (effectiveContractNumber) {
      const existingNumber = await prisma.contract.findFirst({ where: { contractNumber: effectiveContractNumber } });
      if (existingNumber) {
        return res.status(400).json({ error: `Nomor kontrak '${effectiveContractNumber}' sudah terdaftar.` });
      }
    }

    await prisma.contract.update({
      where: { id },
      data: { status: 'AKTIF' },
    });

    const newContract = await prisma.contract.create({
      data: {
        employeeId: oldContract.employeeId,
        contractNumber: effectiveContractNumber,
        contractType: newContractType || oldContract.contractType,
        sequence: (await prisma.contract.count({ where: { employeeId: oldContract.employeeId } })) + 1,
        startDate: new Date(newStartDate),
        endDate: new Date(newEndDate),
        status: 'AKTIF',
        notes: notes || (oldContract.contractNumber ? `Perpanjangan dari kontrak ${oldContract.contractNumber}` : 'Perpanjangan kontrak'),
        createdById: req.user?.id,
      },
      include: { employee: true },
    });

    // Normalize contract statuses for this employee so superseded contracts become DIPERPANJANG
    await normalizeEmployeeContractStatuses(oldContract.employeeId);

    await prisma.contractHistory.create({
      data: {
        contractId: newContract.id,
        changeType: 'EXTEND_CONTRACT',
        previousData: JSON.stringify({ oldContractId: oldContract.id, oldContractNumber: oldContract.contractNumber }),
        newData: JSON.stringify(newContract),
        changedById: req.user?.id,
      },
    });

    await logAudit(req.user?.id, 'EXTEND_CONTRACT', 'CONTRACT', `Extended contract for ${oldContract.employee.name} (New No: ${newContractNumber})`, req.ip || '');

    return res.status(201).json({ message: 'Kontrak berhasil diperpanjang.', contract: newContract });
  } catch (error) {
    console.error('Error extending contract:', error);
    return res.status(500).json({ error: 'Gagal memproses perpanjangan kontrak.' });
  }
});

// POST /api/contracts/:id/upload-document
router.post(
  '/:id/upload-document',
  authenticateJWT,
  requireRole(['ADMIN', 'MANAGEMENT']),
  uploadContractDocument.single('document'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const existing = await prisma.contract.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'File dokumen wajib diunggah (field: document).' });
      }

      const documentUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

      const updated = await prisma.contract.update({
        where: { id },
        data: { documentUrl },
      });

      await prisma.contractHistory.create({
        data: {
          contractId: id,
          changeType: 'UPLOAD_DOCUMENT',
          previousData: existing.documentUrl ? JSON.stringify({ documentUrl: existing.documentUrl }) : null,
          newData: JSON.stringify({ documentUrl }),
          changedById: req.user?.id,
        },
      });

      await logAudit(req.user?.id, 'UPLOAD_CONTRACT_DOCUMENT', 'CONTRACT', `Uploaded document for contract ${existing.contractNumber}`, req.ip || '');

      return res.json({ message: 'Dokumen kontrak berhasil diunggah.', documentUrl });
    } catch (error: any) {
      if (error?.message?.includes('Tipe file')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error uploading contract document:', error);
      return res.status(500).json({ error: 'Gagal mengunggah dokumen kontrak.' });
    }
  }
);

// PUT /api/contracts/:id
router.put('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { contractNumber, contractType, startDate, endDate, status, notes, documentUrl, sequence } = req.body;

    const existing = await prisma.contract.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
    }

    const newSequence = sequence !== undefined && Number(sequence) > 0 ? Number(sequence) : undefined;
    const cleanContractNumber = contractNumber !== undefined
      ? (contractNumber && String(contractNumber).trim() !== '' ? String(contractNumber).trim() : null)
      : existing.contractNumber;

    if (cleanContractNumber && cleanContractNumber !== existing.contractNumber) {
      const duplicate = await prisma.contract.findFirst({
        where: {
          contractNumber: cleanContractNumber,
          id: { not: id },
        },
      });
      if (duplicate) {
        return res.status(400).json({ error: `Nomor kontrak '${cleanContractNumber}' sudah digunakan pada kontrak lain.` });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedContract = await tx.contract.update({
        where: { id },
        data: {
          contractNumber: cleanContractNumber,
          contractType: contractType || existing.contractType,
          startDate: startDate ? new Date(startDate) : existing.startDate,
          endDate: endDate ? new Date(endDate) : existing.endDate,
          status: status || existing.status,
          notes: notes !== undefined ? notes : existing.notes,
          documentUrl: documentUrl !== undefined ? documentUrl : existing.documentUrl,
          sequence: newSequence !== undefined ? newSequence : existing.sequence,
        },
      });

      // Re-normalize the employee's contracts to a clean 1..N order (no gaps or duplicates)
      // when the admin changes the "Kontrak Ke" value.
      if (newSequence !== undefined) {
        const allContracts = await tx.contract.findMany({
          where: { employeeId: existing.employeeId },
          orderBy: [{ sequence: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
        });
        for (let i = 0; i < allContracts.length; i++) {
          if (allContracts[i].sequence !== i + 1) {
            await tx.contract.update({
              where: { id: allContracts[i].id },
              data: { sequence: i + 1 },
            });
          }
        }
      }

      return updatedContract;
    });

    await prisma.contractHistory.create({
      data: {
        contractId: id,
        changeType: 'UPDATE_DETAILS',
        previousData: JSON.stringify(existing),
        newData: JSON.stringify(updated),
        changedById: req.user?.id,
      },
    });

    await normalizeEmployeeContractStatuses(existing.employeeId);

    await logAudit(req.user?.id, 'UPDATE_CONTRACT', 'CONTRACT', `Updated contract ${existing.contractNumber}${newSequence ? ` (Kontrak Ke-${newSequence})` : ''}`, req.ip || '');

    return res.json({ message: 'Data kontrak berhasil diperbarui.', contract: updated });
  } catch (error) {
    console.error('Error updating contract:', error);
    return res.status(500).json({ error: 'Gagal memperbarui kontrak.' });
  }
});

// DELETE /api/contracts/:id
router.delete('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.contract.findUnique({
      where: { id },
      include: { employee: { select: { name: true } } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Kontrak tidak ditemukan.' });
    }

    await prisma.contract.delete({ where: { id } });

    await normalizeEmployeeContractStatuses(existing.employeeId);

    await logAudit(req.user?.id, 'DELETE_CONTRACT', 'CONTRACT', `Deleted contract ${existing.contractNumber} for ${existing.employee?.name || ''}`, req.ip || '');

    return res.json({ message: 'Kontrak berhasil dihapus.' });
  } catch (error) {
    console.error('Error deleting contract:', error);
    return res.status(500).json({ error: 'Gagal menghapus kontrak.' });
  }
});

export default router;
