"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const auditLogger_1 = require("../utils/auditLogger");
const whatsappNotification_1 = require("../services/whatsappNotification");
const contractNormalizer_1 = require("../services/contractNormalizer");
const router = (0, express_1.Router)();
// GET /api/employees
router.get('/', auth_1.authenticateJWT, async (req, res) => {
    try {
        const { search, department, employmentType } = req.query;
        if (req.user?.role === 'USER') {
            if (!req.user.employeeId) {
                return res.status(404).json({ error: 'Data karyawan tidak terhubung dengan akun ini.' });
            }
            const emp = await prisma_1.default.employee.findUnique({
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
        const whereClause = {};
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
            whereClause.employmentType = employmentType;
        }
        const employees = await prisma_1.default.employee.findMany({
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
    }
    catch (error) {
        console.error('Error fetching employees:', error);
        return res.status(500).json({ error: 'Gagal mengambil data karyawan.' });
    }
});
// GET /api/employees/:id
router.get('/:id', auth_1.authenticateJWT, async (req, res) => {
    try {
        const id = String(req.params.id);
        if (req.user?.role === 'USER' && req.user.employeeId !== id) {
            return res.status(403).json({ error: 'Anda hanya dapat melihat data profil pribadi Anda.' });
        }
        const employee = await prisma_1.default.employee.findUnique({
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
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil detail karyawan.' });
    }
});
// POST /api/employees/:id/send-whatsapp — build wa.me link for the employee's phone
router.post('/:id/send-whatsapp', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const employee = await prisma_1.default.employee.findUnique({ where: { id } });
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
        const link = (0, whatsappNotification_1.buildWhatsAppLink)(phone, message);
        if (!link) {
            return res.status(400).json({ error: 'Nomor WhatsApp karyawan tidak valid.' });
        }
        await prisma_1.default.notificationLog.create({
            data: {
                recipient: phone,
                channel: 'WHATSAPP',
                status: 'SENT',
                message: link,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'SEND_WHATSAPP', 'EMPLOYEE', `WhatsApp link dibuka untuk ${employee.name} (${phone})`, req.ip || '');
        return res.json({ link, phone });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal membuat link WhatsApp.' });
    }
});
// POST /api/employees
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { nik, name, email, phone, department, position, level, employmentType, joinDate } = req.body;
        if (!nik || !name || !department || !position || !employmentType || !joinDate) {
            return res.status(400).json({ error: 'Field wajib: NIK, Nama, Departemen, Jabatan, Jenis Hubungan Kerja, dan Tanggal Join.' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(joinDate)) || isNaN(new Date(joinDate).getTime())) {
            return res.status(400).json({ error: 'Tanggal join tidak valid. Gunakan format YYYY-MM-DD.' });
        }
        const existingNik = await prisma_1.default.employee.findUnique({ where: { nik } });
        if (existingNik) {
            return res.status(400).json({ error: `Karyawan dengan NIK '${nik}' sudah terdaftar.` });
        }
        const cleanEmail = email && String(email).trim() !== '' ? String(email).trim() : null;
        const cleanPhone = phone && String(phone).trim() !== '' ? String(phone).trim() : null;
        if (cleanEmail) {
            const existingEmail = await prisma_1.default.employee.findUnique({ where: { email: cleanEmail } });
            if (existingEmail) {
                return res.status(400).json({ error: `Karyawan dengan Email '${cleanEmail}' sudah terdaftar.` });
            }
        }
        // Auto-upsert position master
        if (position) {
            await prisma_1.default.position.upsert({
                where: { name: String(position).trim() },
                update: {},
                create: { name: String(position).trim() },
            }).catch(() => { });
        }
        const employee = await prisma_1.default.employee.create({
            data: {
                nik,
                name,
                email: cleanEmail,
                phone: cleanPhone,
                department,
                position,
                level: level || 'Staff',
                employmentType,
                joinDate: new Date(joinDate),
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'CREATE_EMPLOYEE', 'EMPLOYEE', `Created employee ${employee.name} (${employee.nik})`, req.ip || '');
        return res.status(201).json({ message: 'Karyawan berhasil ditambahkan.', employee });
    }
    catch (error) {
        console.error('Error creating employee:', error);
        return res.status(500).json({ error: 'Gagal menambahkan karyawan.' });
    }
});
// PUT /api/employees/:id
router.put('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const { name, email, phone, department, position, level, employmentType, joinDate } = req.body;
        const existing = await prisma_1.default.employee.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        }
        const cleanEmail = email !== undefined
            ? (email && String(email).trim() !== '' ? String(email).trim() : null)
            : existing.email;
        const cleanPhone = phone !== undefined
            ? (phone && String(phone).trim() !== '' ? String(phone).trim() : null)
            : existing.phone;
        if (cleanEmail && cleanEmail !== existing.email) {
            const existingEmail = await prisma_1.default.employee.findUnique({ where: { email: cleanEmail } });
            if (existingEmail) {
                return res.status(400).json({ error: `Karyawan dengan Email '${cleanEmail}' sudah terdaftar.` });
            }
        }
        // Auto-upsert position master
        if (position) {
            await prisma_1.default.position.upsert({
                where: { name: String(position).trim() },
                update: {},
                create: { name: String(position).trim() },
            }).catch(() => { });
        }
        const updated = await prisma_1.default.employee.update({
            where: { id },
            data: {
                name: name || existing.name,
                email: cleanEmail,
                phone: cleanPhone,
                department: department || existing.department,
                position: position || existing.position,
                level: level !== undefined ? level : existing.level,
                employmentType: employmentType || existing.employmentType,
                joinDate: joinDate ? new Date(joinDate) : existing.joinDate,
            },
        });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'UPDATE_EMPLOYEE', 'EMPLOYEE', `Updated employee ${updated.name} (${updated.nik})`, req.ip || '');
        return res.json({ message: 'Data karyawan berhasil diperbarui.', employee: updated });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memperbarui data karyawan.' });
    }
});
// DELETE /api/employees/:id
router.delete('/:id', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN']), async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.default.employee.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        }
        await prisma_1.default.employee.delete({ where: { id } });
        await (0, auditLogger_1.logAudit)(req.user?.id, 'DELETE_EMPLOYEE', 'EMPLOYEE', `Deleted employee ${existing.name} (${existing.nik})`, req.ip || '');
        return res.json({ message: 'Karyawan berhasil dihapus.' });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal menghapus data karyawan.' });
    }
});
// POST /api/employees/bulk-import
router.post('/bulk-import', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { employees } = req.body;
        if (!Array.isArray(employees) || employees.length === 0) {
            return res.status(400).json({ error: 'Data karyawan untuk diproses tidak valid.' });
        }
        let successCount = 0;
        let failedCount = 0;
        const errors = [];
        // Group incoming rows by NIK so multiple rows for the same employee form contract sequence 1, 2, 3...
        const empMap = new Map();
        const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
        for (const emp of employees) {
            if (!emp.nik || !emp.name || !emp.department || !emp.position || !emp.employmentType || !emp.joinDate) {
                failedCount++;
                errors.push(`Baris dengan NIK ${emp.nik || 'N/A'}: Data tidak lengkap (wajib: NIK, Nama, Departemen, Jabatan, Jenis, Tanggal Join).`);
                continue;
            }
            const joinDate = new Date(emp.joinDate);
            if (isNaN(joinDate.getTime()) || !isoPattern.test(String(emp.joinDate))) {
                failedCount++;
                errors.push(`Baris dengan NIK ${emp.nik}: JoinDate '${emp.joinDate}' tidak valid. Gunakan format YYYY-MM-DD.`);
                continue;
            }
            const nik = String(emp.nik).trim();
            const cleanEmail = emp.email && String(emp.email).trim() !== '' ? String(emp.email).trim() : null;
            const cleanPhone = emp.phone && String(emp.phone).trim() !== '' ? String(emp.phone).trim() : null;
            const department = String(emp.department).trim();
            const position = String(emp.position).trim();
            const level = emp.level ? String(emp.level).trim() : 'Staff';
            const employmentType = (emp.employmentType || 'PKWT');
            if (!empMap.has(nik)) {
                empMap.set(nik, {
                    nik,
                    name: String(emp.name).trim(),
                    email: cleanEmail,
                    phone: cleanPhone,
                    department,
                    position,
                    level,
                    employmentType,
                    joinDate,
                    contracts: [],
                });
            }
            const currentEmp = empMap.get(nik);
            if (!currentEmp.email && cleanEmail)
                currentEmp.email = cleanEmail;
            if (!currentEmp.phone && cleanPhone)
                currentEmp.phone = cleanPhone;
            if (emp.contractStartDate && emp.contractEndDate) {
                const sDate = new Date(emp.contractStartDate);
                const eDate = new Date(emp.contractEndDate);
                if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
                    const rawContractNo = emp.contractNumber && String(emp.contractNumber).trim() !== '' ? String(emp.contractNumber).trim() : null;
                    currentEmp.contracts.push({
                        contractNumber: rawContractNo,
                        startDate: sDate,
                        endDate: eDate,
                        statusStr: String(emp.contractNotes || emp.status || ''),
                        contractType: (emp.contractType || employmentType),
                    });
                }
            }
        }
        // Sync departments
        const uniqueDepts = Array.from(new Set(Array.from(empMap.values()).map((e) => e.department).filter(Boolean)));
        for (const d of uniqueDepts) {
            await prisma_1.default.department.upsert({
                where: { name: d },
                update: {},
                create: { name: d },
            }).catch(() => { });
        }
        // Sync positions
        const uniquePositions = Array.from(new Set(Array.from(empMap.values()).map((e) => e.position).filter(Boolean)));
        for (const p of uniquePositions) {
            await prisma_1.default.position.upsert({
                where: { name: p },
                update: {},
                create: { name: p },
            }).catch(() => { });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const [, empData] of empMap.entries()) {
            try {
                const employee = await prisma_1.default.employee.upsert({
                    where: { nik: empData.nik },
                    update: {
                        name: empData.name,
                        ...(empData.email ? { email: empData.email } : {}),
                        phone: empData.phone,
                        department: empData.department,
                        position: empData.position,
                        level: empData.level,
                        employmentType: empData.employmentType,
                        joinDate: empData.joinDate,
                    },
                    create: {
                        nik: empData.nik,
                        name: empData.name,
                        email: empData.email,
                        phone: empData.phone,
                        department: empData.department,
                        position: empData.position,
                        level: empData.level,
                        employmentType: empData.employmentType,
                        joinDate: empData.joinDate,
                    },
                });
                // Record all contracts (sorted by startDate ascending)
                if (empData.contracts.length > 0) {
                    empData.contracts.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
                    // Clean existing contracts if re-importing this employee to keep clean 1..N order
                    await prisma_1.default.contract.deleteMany({ where: { employeeId: employee.id } });
                    const total = empData.contracts.length;
                    for (let i = 0; i < total; i++) {
                        const c = empData.contracts[i];
                        const seq = i + 1;
                        const isLatest = i === total - 1;
                        const diffDays = Math.ceil((c.endDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
                        const isResign = c.statusStr.toLowerCase().includes('resign') ||
                            c.statusStr.toLowerCase().includes('exit') ||
                            c.statusStr.toLowerCase().includes('keluar');
                        let status = 'DIPERPANJANG';
                        if (isResign) {
                            status = 'RESIGN';
                        }
                        else if (isLatest) {
                            if (c.contractType === 'PKWTT' || empData.employmentType === 'PKWTT') {
                                status = 'AKTIF';
                            }
                            else if (diffDays <= 0) {
                                status = 'EXPIRED';
                            }
                            else if (diffDays <= 30) {
                                status = 'AKAN_BERAKHIR';
                            }
                            else {
                                status = 'AKTIF';
                            }
                        }
                        const notes = isResign
                            ? `Resign${c.statusStr ? ` - ${c.statusStr}` : ''}`
                            : (c.statusStr ? c.statusStr : `Kontrak Ke-${seq}`);
                        await prisma_1.default.contract.create({
                            data: {
                                employeeId: employee.id,
                                contractNumber: c.contractNumber,
                                contractType: c.contractType,
                                sequence: seq,
                                startDate: c.startDate,
                                endDate: c.endDate,
                                status,
                                notes,
                                createdById: req.user?.id || null,
                            },
                        });
                    }
                }
                successCount++;
            }
            catch (err) {
                failedCount++;
                const errorMessage = err instanceof Error ? err.message : String(err);
                errors.push(`Error NIK ${empData.nik}: ${errorMessage}`);
            }
        }
        // Normalize contract statuses across all employees
        await (0, contractNormalizer_1.normalizeEmployeeContractStatuses)();
        await (0, auditLogger_1.logAudit)(req.user?.id, 'BULK_IMPORT', 'EMPLOYEE', `Imported ${successCount} employees (${failedCount} failed)`, req.ip || '');
        return res.json({
            message: `Proses import selesai. Berhasil: ${successCount} karyawan, Gagal: ${failedCount}`,
            successCount,
            failedCount,
            errors,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal memproses bulk import karyawan.' });
    }
});
exports.default = router;
