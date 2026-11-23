import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { normalizeEmployeeContractStatuses } from '../services/contractNormalizer';

const router = Router();

// GET /api/reconcile/analysis - Scan database for all data discrepancies and anomalies
router.get('/analysis', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      include: {
        contracts: {
          orderBy: { startDate: 'asc' },
        },
        user: {
          select: { id: true, email: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // 1. Group by normalized name to find potential duplicate employees with different NIK
    const nameMap = new Map<string, typeof employees>();
    for (const emp of employees) {
      // Clean string: lowercase, remove special characters & double spaces
      const normalizedName = emp.name
        .toLowerCase()
        .replace(/[^\w\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!nameMap.has(normalizedName)) {
        nameMap.set(normalizedName, []);
      }
      nameMap.get(normalizedName)!.push(emp);
    }

    const duplicateEmployees: Array<{
      normalizedName: string;
      displayName: string;
      count: number;
      records: Array<{
        id: string;
        nik: string;
        name: string;
        email: string | null;
        phone: string | null;
        department: string;
        position: string;
        level: string | null;
        employmentType: string;
        joinDate: string;
        contractsCount: number;
        contracts: Array<{
          id: string;
          sequence: number;
          contractNumber: string | null;
          startDate: string;
          endDate: string;
          status: string;
        }>;
      }>;
      recommendation: string;
    }> = [];

    for (const [normName, list] of nameMap.entries()) {
      if (list.length > 1) {
        duplicateEmployees.push({
          normalizedName: normName,
          displayName: list[0].name,
          count: list.length,
          records: list.map((e) => ({
            id: e.id,
            nik: e.nik,
            name: e.name,
            email: e.email,
            phone: e.phone,
            department: e.department,
            position: e.position,
            level: e.level,
            employmentType: e.employmentType,
            joinDate: e.joinDate.toISOString().split('T')[0],
            contractsCount: e.contracts.length,
            contracts: e.contracts.map((c) => ({
              id: c.id,
              sequence: c.sequence,
              contractNumber: c.contractNumber,
              startDate: c.startDate.toISOString().split('T')[0],
              endDate: c.endDate.toISOString().split('T')[0],
              status: c.status,
            })),
          })),
          recommendation: `Ditemukan ${list.length} data dengan nama identik namun NIK berbeda (${list.map((e) => e.nik).join(' vs ')}). Disarankan untuk menggabungkan (merge) ke NIK yang valid.`,
        });
      }
    }

    // 2. Duplicate contract numbers across different employees
    const allContracts = await prisma.contract.findMany({
      where: {
        contractNumber: { not: null },
      },
      include: {
        employee: {
          select: { id: true, nik: true, name: true, department: true, position: true },
        },
      },
    });

    const contractMap = new Map<string, typeof allContracts>();
    for (const c of allContracts) {
      if (!c.contractNumber || c.contractNumber.trim() === '') continue;
      const key = c.contractNumber.trim();
      if (!contractMap.has(key)) {
        contractMap.set(key, []);
      }
      contractMap.get(key)!.push(c);
    }

    const duplicateContractNumbers: Array<{
      contractNumber: string;
      count: number;
      employees: Array<{
        contractId: string;
        employeeId: string;
        nik: string;
        name: string;
        department: string;
        position: string;
        sequence: number;
        startDate: string;
        endDate: string;
        status: string;
      }>;
    }> = [];

    for (const [contractNo, list] of contractMap.entries()) {
      // Check if it belongs to different employees
      const uniqueEmpIds = new Set(list.map((c) => c.employeeId));
      if (uniqueEmpIds.size > 1) {
        duplicateContractNumbers.push({
          contractNumber: contractNo,
          count: list.length,
          employees: list.map((c) => ({
            contractId: c.id,
            employeeId: c.employee.id,
            nik: c.employee.nik,
            name: c.employee.name,
            department: c.employee.department,
            position: c.employee.position,
            sequence: c.sequence,
            startDate: c.startDate.toISOString().split('T')[0],
            endDate: c.endDate.toISOString().split('T')[0],
            status: c.status,
          })),
        });
      }
    }

    // 3. Contract date anomalies (e.g. End Date < Start Date, or overlap)
    const dateAnomalies: Array<{
      contractId: string;
      employeeId: string;
      nik: string;
      name: string;
      contractNumber: string | null;
      startDate: string;
      endDate: string;
      issue: string;
    }> = [];

    for (const emp of employees) {
      for (let i = 0; i < emp.contracts.length; i++) {
        const c = emp.contracts[i];
        if (c.endDate.getTime() < c.startDate.getTime()) {
          dateAnomalies.push({
            contractId: c.id,
            employeeId: emp.id,
            nik: emp.nik,
            name: emp.name,
            contractNumber: c.contractNumber,
            startDate: c.startDate.toISOString().split('T')[0],
            endDate: c.endDate.toISOString().split('T')[0],
            issue: 'Tanggal berakhir mendahului tanggal mulai kontrak (tanggal terbalik).',
          });
        }
      }
    }

    // 4. Missing critical info (no email, no phone, or 0 contracts)
    const missingInfo: Array<{
      employeeId: string;
      nik: string;
      name: string;
      department: string;
      position: string;
      missing: string[];
    }> = [];

    for (const emp of employees) {
      const missing: string[] = [];
      if (!emp.email) missing.push('Email');
      if (!emp.phone) missing.push('No. Telepon');
      if (emp.contracts.length === 0) missing.push('Belum Memiliki Kontrak');
      if (missing.length > 0) {
        missingInfo.push({
          employeeId: emp.id,
          nik: emp.nik,
          name: emp.name,
          department: emp.department,
          position: emp.position,
          missing,
        });
      }
    }

    return res.json({
      summary: {
        totalEmployees: employees.length,
        duplicateNameCount: duplicateEmployees.length,
        duplicateContractNoCount: duplicateContractNumbers.length,
        dateAnomaliesCount: dateAnomalies.length,
        missingInfoCount: missingInfo.length,
      },
      duplicateEmployees,
      duplicateContractNumbers,
      dateAnomalies,
      missingInfo,
    });
  } catch (error) {
    console.error('Error analyzing data reconciliation:', error);
    return res.status(500).json({ error: 'Gagal menganalisis rekonsiliasi data.' });
  }
});

// POST /api/reconcile/merge-employees - Merge two duplicate employee records into one valid employee
router.post('/merge-employees', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { primaryEmployeeId, duplicateEmployeeId, targetNik, targetName, targetEmail, targetPhone, targetDept, targetPos } = req.body;

    if (!primaryEmployeeId || !duplicateEmployeeId) {
      return res.status(400).json({ error: 'ID Karyawan Utama dan ID Karyawan Duplikat wajib diisi.' });
    }

    if (primaryEmployeeId === duplicateEmployeeId) {
      return res.status(400).json({ error: 'Karyawan utama dan duplikat tidak boleh sama.' });
    }

    const [primaryEmp, dupEmp] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: primaryEmployeeId },
        include: { contracts: true, user: true },
      }),
      prisma.employee.findUnique({
        where: { id: duplicateEmployeeId },
        include: { contracts: true, user: true },
      }),
    ]);

    if (!primaryEmp || !dupEmp) {
      return res.status(404).json({ error: 'Salah satu data karyawan tidak ditemukan.' });
    }

    // Run transaction: move relations, delete duplicate, normalize sequences
    const result = await prisma.$transaction(async (tx) => {
      // 1. If duplicate has a user account and primary doesn't, link it to primary
      if (dupEmp.user && !primaryEmp.user) {
        await tx.user.update({
          where: { id: dupEmp.user.id },
          data: { employeeId: primaryEmployeeId },
        });
      } else if (dupEmp.user && primaryEmp.user) {
        // Both have user account, unlink duplicate's user account
        await tx.user.update({
          where: { id: dupEmp.user.id },
          data: { employeeId: null },
        });
      }

      // 2. Move all contracts from duplicate to primary
      await tx.contract.updateMany({
        where: { employeeId: duplicateEmployeeId },
        data: { employeeId: primaryEmployeeId },
      });

      // 3. Move submissions
      await tx.submissionForm.updateMany({
        where: { employeeId: duplicateEmployeeId },
        data: { employeeId: primaryEmployeeId },
      });

      // 4. Move evaluations
      await tx.contractEvaluation.updateMany({
        where: { employeeId: duplicateEmployeeId },
        data: { employeeId: primaryEmployeeId },
      });

      // 5. Delete duplicate employee record
      await tx.employee.delete({
        where: { id: duplicateEmployeeId },
      });

      // 6. Update primary employee details if specified
      const finalEmail = targetEmail !== undefined ? (targetEmail || null) : (primaryEmp.email || dupEmp.email || null);
      const finalPhone = targetPhone !== undefined ? (targetPhone || null) : (primaryEmp.phone || dupEmp.phone || null);
      const finalNik = targetNik || primaryEmp.nik;
      const finalName = targetName || primaryEmp.name;
      const finalDept = targetDept || primaryEmp.department;
      const finalPos = targetPos || primaryEmp.position;

      // Ensure earliest joinDate is preserved
      const earliestJoinDate = primaryEmp.joinDate < dupEmp.joinDate ? primaryEmp.joinDate : dupEmp.joinDate;

      const updatedPrimary = await tx.employee.update({
        where: { id: primaryEmployeeId },
        data: {
          nik: finalNik,
          name: finalName,
          email: finalEmail,
          phone: finalPhone,
          department: finalDept,
          position: finalPos,
          joinDate: earliestJoinDate,
        },
      });

      // 7. Re-sequence all contracts of primary employee chronologically by startDate
      const allEmpContracts = await tx.contract.findMany({
        where: { employeeId: primaryEmployeeId },
        orderBy: { startDate: 'asc' },
      });

      for (let i = 0; i < allEmpContracts.length; i++) {
        await tx.contract.update({
          where: { id: allEmpContracts[i].id },
          data: { sequence: i + 1 },
        });
      }

      return { updatedPrimary, totalContracts: allEmpContracts.length };
    });

    // Normalize contract status
    await normalizeEmployeeContractStatuses(primaryEmployeeId).catch(() => {});

    await logAudit(
      req.user?.id,
      'MERGE_EMPLOYEE',
      'EMPLOYEE',
      `Merged employee duplicate ${dupEmp.name} (${dupEmp.nik}) into ${result.updatedPrimary.name} (${result.updatedPrimary.nik}). Total contracts: ${result.totalContracts}`,
      req.ip || ''
    );

    return res.json({
      message: `Berhasil menggabungkan data! Karyawan ${result.updatedPrimary.name} sekarang memiliki ${result.totalContracts} riwayat kontrak dengan NIK ${result.updatedPrimary.nik}.`,
      employee: result.updatedPrimary,
    });
  } catch (error) {
    console.error('Error merging employees:', error);
    return res.status(500).json({ error: 'Gagal menggabungkan data karyawan.' });
  }
});

// PUT /api/reconcile/fix-contract-date - Fix inverted or wrong dates for a contract
router.put('/fix-contract-date', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, startDate, endDate } = req.body;

    if (!contractId || !startDate || !endDate) {
      return res.status(400).json({ error: 'ID Kontrak, Tanggal Mulai, dan Tanggal Berakhir wajib diisi.' });
    }

    const sDate = new Date(startDate);
    const eDate = new Date(endDate);

    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return res.status(400).json({ error: 'Format tanggal tidak valid.' });
    }

    if (eDate < sDate) {
      return res.status(400).json({ error: 'Tanggal berakhir tidak boleh mendahului tanggal mulai.' });
    }

    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: {
        startDate: sDate,
        endDate: eDate,
      },
      include: { employee: true },
    });

    await normalizeEmployeeContractStatuses(contract.employeeId).catch(() => {});

    await logAudit(
      req.user?.id,
      'UPDATE_CONTRACT_DATES',
      'CONTRACT',
      `Updated dates for contract ${contract.contractNumber || contract.id} of ${contract.employee.name}: ${startDate} to ${endDate}`,
      req.ip || ''
    );

    return res.json({ message: 'Tanggal kontrak berhasil diperbarui.', contract });
  } catch (error) {
    console.error('Error fixing contract date:', error);
    return res.status(500).json({ error: 'Gagal memperbarui tanggal kontrak.' });
  }
});

// PUT /api/reconcile/fix-contract-number - Update duplicate contract number
router.put('/fix-contract-number', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { contractId, newContractNumber } = req.body;

    if (!contractId || !newContractNumber || String(newContractNumber).trim() === '') {
      return res.status(400).json({ error: 'ID Kontrak dan Nomor Kontrak baru wajib diisi.' });
    }

    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: {
        contractNumber: String(newContractNumber).trim(),
      },
      include: { employee: true },
    });

    await logAudit(
      req.user?.id,
      'UPDATE_CONTRACT_NUMBER',
      'CONTRACT',
      `Updated contract number to ${newContractNumber} for ${contract.employee.name}`,
      req.ip || ''
    );

    return res.json({ message: 'Nomor kontrak berhasil diperbarui.', contract });
  } catch (error) {
    console.error('Error fixing contract number:', error);
    return res.status(500).json({ error: 'Gagal memperbarui nomor kontrak.' });
  }
});

export default router;
