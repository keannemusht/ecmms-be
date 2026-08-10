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
                        orderBy: { createdAt: 'desc' },
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
                    orderBy: { endDate: 'desc' },
                    take: 1,
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
                    orderBy: { startDate: 'desc' },
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
// POST /api/employees
router.post('/', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { nik, name, email, phone, department, position, employmentType, joinDate } = req.body;
        if (!nik || !name || !email || !department || !position || !employmentType || !joinDate) {
            return res.status(400).json({ error: 'Field wajib: NIK, Nama, Email, Departemen, Jabatan, Jenis Hubungan Kerja, dan Tanggal Join.' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(joinDate)) || isNaN(new Date(joinDate).getTime())) {
            return res.status(400).json({ error: 'Tanggal join tidak valid. Gunakan format YYYY-MM-DD.' });
        }
        const existingNik = await prisma_1.default.employee.findUnique({ where: { nik } });
        if (existingNik) {
            return res.status(400).json({ error: `Karyawan dengan NIK '${nik}' sudah terdaftar.` });
        }
        const existingEmail = await prisma_1.default.employee.findUnique({ where: { email } });
        if (existingEmail) {
            return res.status(400).json({ error: `Karyawan dengan Email '${email}' sudah terdaftar.` });
        }
        const employee = await prisma_1.default.employee.create({
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
        const { name, email, phone, department, position, employmentType, joinDate } = req.body;
        const existing = await prisma_1.default.employee.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
        }
        const updated = await prisma_1.default.employee.update({
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
                await prisma_1.default.employee.upsert({
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
                successCount++;
            }
            catch (err) {
                failedCount++;
                const errorMessage = err instanceof Error ? err.message : String(err);
                errors.push(`Error NIK ${emp.nik}: ${errorMessage}`);
            }
        }
        await (0, auditLogger_1.logAudit)(req.user?.id, 'BULK_IMPORT', 'EMPLOYEE', `Imported ${successCount} employees (${failedCount} failed)`, req.ip || '');
        return res.json({
            message: `Proses import selesai. Berhasil: ${successCount}, Gagal: ${failedCount}`,
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
