import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { logAudit } from '../utils/auditLogger';
import { buildWhatsAppLink } from '../services/whatsappNotification';
import { Prisma, EmploymentType } from '@prisma/client';
import { normalizeEmployeeContractStatuses } from '../services/contractNormalizer';

const router = Router();

// GET /api/employees
router.get('/', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { search, department, employmentType } = req.query;

    if (req.user?.role === 'USER') {
      if (!req.user.employeeId) {
        return res.status(404).json({ error: 'Data karyawan tidak terhubung dengan akun ini.' });
      }

      const emp = await prisma.employee.findUnique({
        where: { id: req.user.employeeId },
        include: {
          contracts: {
            orderBy: [{ sequence: 'asc' }],
          },
          submissions: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      return res.json({ employees: emp ? [emp] : [], total: emp ? 1 : 0 });
    }

    const whereClause: Prisma.EmployeeWhereInput = {};

    if (search) {
      whereClause.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { nik: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { position: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    if (department) {
      whereClause.department = String(department);
    }

    if (employmentType) {
      whereClause.employmentType = employmentType as EmploymentType;
    }

    const employees = await prisma.employee.findMany({
      where: whereClause,
      include: {
        contracts: {
          orderBy: [{ sequence: 'asc' }],
        },
        user: {
          select: { id: true, email: true, role: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ employees, total: employees.length });
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({ error: 'Gagal mengambil data karyawan.' });
  }
});

// GET /api/employees/:id
router.get('/:id', authenticateJWT, async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    if (req.user?.role === 'USER' && req.user.employeeId !== id) {
      return res.status(403).json({ error: 'Anda hanya dapat melihat data profil pribadi Anda.' });
    }

    const employee = await prisma.employee.findUnique({
      where: { id },
      include: {
        contracts: {
          include: {
            history: {
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: [{ sequence: 'asc' }],
        },
        submissions: {
          orderBy: { createdAt: 'desc' },
        },
        user: {
          select: { id: true, email: true, role: true, isActive: true },
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    }

    return res.json(employee);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil detail karyawan.' });
  }
});

// POST /api/employees/:id/send-whatsapp — build wa.me link for the employee's phone
router.post('/:id/send-whatsapp', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const employee = await prisma.employee.findUnique({ where: { id } });

    if (!employee) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    }

    const phone = employee.phone;
    if (!phone) {
      return res.status(400).json({ error: 'Karyawan ini belum memiliki nomor telepon.' });
    }

    const message = [
      `*Informasi Karyawan*`,
      `*${employee.name}*`,
      '',
      `NIK: ${employee.nik}`,
      `Departemen: ${employee.department}`,
      `Jabatan: ${employee.position}`,
      `Email: ${employee.email}`,
      `Tipe Kontrak: ${employee.employmentType}`,
      `Tanggal Bergabung: ${new Date(employee.joinDate).toISOString().split('T')[0]}`,
      '',
      'Pesan ini dikirim melalui sistem monitoring kontrak PKWT.',
    ].join('\n');

    const link = buildWhatsAppLink(phone, message);
    if (!link) {
      return res.status(400).json({ error: 'Nomor WhatsApp karyawan tidak valid.' });
    }

    await prisma.notificationLog.create({
      data: {
        recipient: phone,
        channel: 'WHATSAPP',
        status: 'SENT',
        message: link,
      },
    });

    await logAudit(req.user?.id, 'SEND_WHATSAPP', 'EMPLOYEE', `WhatsApp link dibuka untuk ${employee.name} (${phone})`, req.ip || '');

    return res.json({ link, phone });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal membuat link WhatsApp.' });
  }
});

// POST /api/employees
router.post('/', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { nik, name, email, phone, department, position, employmentType, joinDate } = req.body;

    if (!nik || !name || !email || !department || !position || !employmentType || !joinDate) {
      return res.status(400).json({ error: 'Field wajib: NIK, Nama, Email, Departemen, Jabatan, Jenis Hubungan Kerja, dan Tanggal Join.' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(joinDate)) || isNaN(new Date(joinDate).getTime())) {
      return res.status(400).json({ error: 'Tanggal join tidak valid. Gunakan format YYYY-MM-DD.' });
    }

    const existingNik = await prisma.employee.findUnique({ where: { nik } });
    if (existingNik) {
      return res.status(400).json({ error: `Karyawan dengan NIK '${nik}' sudah terdaftar.` });
    }

    const existingEmail = await prisma.employee.findUnique({ where: { email } });
    if (existingEmail) {
      return res.status(400).json({ error: `Karyawan dengan Email '${email}' sudah terdaftar.` });
    }

    const employee = await prisma.employee.create({
      data: {
        nik,
        name,
        email,
        phone: phone || null,
        department,
        position,
        employmentType,
        joinDate: new Date(joinDate),
      },
    });

    await logAudit(req.user?.id, 'CREATE_EMPLOYEE', 'EMPLOYEE', `Created employee ${employee.name} (${employee.nik})`, req.ip || '');

    return res.status(201).json({ message: 'Karyawan berhasil ditambahkan.', employee });
  } catch (error) {
    console.error('Error creating employee:', error);
    return res.status(500).json({ error: 'Gagal menambahkan karyawan.' });
  }
});

// PUT /api/employees/:id
router.put('/:id', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, email, phone, department, position, employmentType, joinDate } = req.body;

    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        name: name || existing.name,
        email: email || existing.email,
        phone: phone !== undefined ? phone : existing.phone,
        department: department || existing.department,
        position: position || existing.position,
        employmentType: employmentType || existing.employmentType,
        joinDate: joinDate ? new Date(joinDate) : existing.joinDate,
      },
    });

    await logAudit(req.user?.id, 'UPDATE_EMPLOYEE', 'EMPLOYEE', `Updated employee ${updated.name} (${updated.nik})`, req.ip || '');

    return res.json({ message: 'Data karyawan berhasil diperbarui.', employee: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memperbarui data karyawan.' });
  }
});

// DELETE /api/employees/:id
router.delete('/:id', authenticateJWT, requireRole(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    }

    await prisma.employee.delete({ where: { id } });

    await logAudit(req.user?.id, 'DELETE_EMPLOYEE', 'EMPLOYEE', `Deleted employee ${existing.name} (${existing.nik})`, req.ip || '');

    return res.json({ message: 'Karyawan berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal menghapus data karyawan.' });
  }
});

// POST /api/employees/bulk-import
router.post('/bulk-import', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ error: 'Data karyawan untuk diproses tidak valid.' });
    }

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    const perNikNextSequence = new Map<string, number>();

    for (const emp of employees) {
      try {
        if (!emp.nik || !emp.name || !emp.email || !emp.department || !emp.position || !emp.employmentType || !emp.joinDate) {
          failedCount++;
          errors.push(`Baris dengan NIK ${emp.nik || 'N/A'}: Data tidak lengkap.`);
          continue;
        }

        const joinDate = new Date(emp.joinDate);
        const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
        if (isNaN(joinDate.getTime()) || !isoPattern.test(String(emp.joinDate))) {
          failedCount++;
          errors.push(`Baris dengan NIK ${emp.nik}: JoinDate '${emp.joinDate}' tidak valid. Gunakan format YYYY-MM-DD.`);
          continue;
        }

        const employee = await prisma.employee.upsert({
          where: { nik: emp.nik },
          update: {
            name: emp.name,
            email: emp.email,
            phone: emp.phone || null,
            department: emp.department,
            position: emp.position,
            employmentType: emp.employmentType,
            joinDate,
          },
          create: {
            nik: emp.nik,
            name: emp.name,
            email: emp.email,
            phone: emp.phone || null,
            department: emp.department,
            position: emp.position,
            employmentType: emp.employmentType,
            joinDate,
          },
        });

        // Optional contract history columns: No Kontrak, Tgl Mulai, Tgl Berakhir, Jenis Kontrak.
        // Repeating the same NIK on multiple rows records the 1st, 2nd, 3rd ... contract.
        if (emp.contractNumber) {
          const startDate = new Date(emp.contractStartDate);
          const endDate = new Date(emp.contractEndDate);
          if (
            isNaN(startDate.getTime()) ||
            isNaN(endDate.getTime()) ||
            !isoPattern.test(String(emp.contractStartDate)) ||
            !isoPattern.test(String(emp.contractEndDate))
          ) {
            failedCount++;
            errors.push(`Baris dengan NIK ${emp.nik} (kontrak ${emp.contractNumber}): Tanggal kontrak tidak valid. Gunakan format YYYY-MM-DD.`);
            continue;
          }

          let nextSeq = perNikNextSequence.get(emp.nik);
          if (nextSeq === undefined) {
            const existingCount = await prisma.contract.count({ where: { employeeId: employee.id } });
            nextSeq = existingCount;
            perNikNextSequence.set(emp.nik, nextSeq);
          }
          nextSeq += 1;
          perNikNextSequence.set(emp.nik, nextSeq);

          const today = new Date();
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
          const contractType = (emp.contractType || emp.employmentType) as EmploymentType;

          let status: 'AKTIF' | 'AKAN_BERAKHIR' | 'EXPIRED' | 'DIANGKAT_TETAP' = 'AKTIF';
          if (diffDays <= 0) {
            status = 'EXPIRED';
          } else if (diffDays <= 30) {
            status = 'AKAN_BERAKHIR';
          }
          if (contractType === 'PKWTT') {
            status = 'DIANGKAT_TETAP';
          }

          const createdContract = await prisma.contract.create({
            data: {
              employeeId: employee.id,
              contractNumber: String(emp.contractNumber),
              contractType,
              sequence: nextSeq,
              startDate,
              endDate,
              status,
              createdById: req.user?.id || null,
              notes: `Import massal${emp.contractNotes ? `: ${emp.contractNotes}` : ''}`,
            },
          });

          // This contract is the successor of any earlier contract for this employee,
          // so previously EXPIRED contracts (including earlier rows of this same
          // import) become historical DIPERPANJANG instead of showing under "Expired".
          // The just-created contract is excluded: if it is the employee's latest and
          // ended, it correctly stays EXPIRED.
          await prisma.contract.updateMany({
            where: { employeeId: employee.id, status: 'EXPIRED', id: { not: createdContract.id } },
            data: { status: 'DIPERPANJANG' },
          });
        }

        successCount++;
      } catch (err: unknown) {
        failedCount++;
        const errorMessage = err instanceof Error ? err.message : String(err);
        errors.push(`Error NIK ${emp.nik}: ${errorMessage}`);
      }
    }

    // Normalize contract statuses across all employees after bulk import completes
    await normalizeEmployeeContractStatuses();

    await logAudit(req.user?.id, 'BULK_IMPORT', 'EMPLOYEE', `Imported ${successCount} employees (${failedCount} failed)`, req.ip || '');

    return res.json({
      message: `Proses import selesai. Berhasil: ${successCount}, Gagal: ${failedCount}`,
      successCount,
      failedCount,
      errors,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal memproses bulk import karyawan.' });
  }
});

export default router;
