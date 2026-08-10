"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const exceljs_1 = __importDefault(require("exceljs"));
const router = (0, express_1.Router)();
// GET /api/reports/contracts/export (Export Contracts to Excel)
router.get('/contracts/export', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const { status, department, employmentType } = req.query;
        const whereClause = {};
        if (status)
            whereClause.status = status;
        if (employmentType)
            whereClause.contractType = employmentType;
        if (department)
            whereClause.employee = { department: String(department) };
        const contracts = await prisma_1.default.contract.findMany({
            where: whereClause,
            include: {
                employee: true,
            },
            orderBy: { endDate: 'asc' },
        });
        const workbook = new exceljs_1.default.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Kontrak Karyawan');
        // Header styling
        worksheet.columns = [
            { header: 'No', key: 'no', width: 5 },
            { header: 'NIK', key: 'nik', width: 15 },
            { header: 'Nama Karyawan', key: 'name', width: 25 },
            { header: 'Departemen', key: 'department', width: 20 },
            { header: 'Jabatan', key: 'position', width: 22 },
            { header: 'Jenis Kontrak', key: 'contractType', width: 15 },
            { header: 'No. Kontrak', key: 'contractNumber', width: 22 },
            { header: 'Tanggal Mulai', key: 'startDate', width: 15 },
            { header: 'Tanggal Berakhir', key: 'endDate', width: 15 },
            { header: 'Status', key: 'status', width: 18 },
            { header: 'Catatan', key: 'notes', width: 30 },
        ];
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '1E293B' }, // Dark slate blue header
        };
        contracts.forEach((c, index) => {
            worksheet.addRow({
                no: index + 1,
                nik: c.employee.nik,
                name: c.employee.name,
                department: c.employee.department,
                position: c.employee.position,
                contractType: c.contractType,
                contractNumber: c.contractNumber,
                startDate: c.startDate ? c.startDate.toISOString().split('T')[0] : '-',
                endDate: c.endDate ? c.endDate.toISOString().split('T')[0] : '-',
                status: c.status,
                notes: c.notes || '-',
            });
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Laporan_Kontrak_PKWT_${new Date().toISOString().split('T')[0]}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (error) {
        console.error('Export Excel error:', error);
        return res.status(500).json({ error: 'Gagal membuat laporan Excel.' });
    }
});
exports.default = router;
