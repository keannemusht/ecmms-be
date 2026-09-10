"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const contractNormalizer_1 = require("../services/contractNormalizer");
const router = (0, express_1.Router)();
// GET /api/dashboard/summary
router.get('/summary', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        // Ensure contracts are normalized before summarizing
        await (0, contractNormalizer_1.normalizeEmployeeContractStatuses)();
        const today = new Date();
        // Counts by Employment Type
        const totalEmployees = await prisma_1.default.employee.count();
        const pkwtCount = await prisma_1.default.employee.count({ where: { employmentType: 'PKWT' } });
        const pkwttCount = await prisma_1.default.employee.count({ where: { employmentType: 'PKWTT' } });
        const magangCount = await prisma_1.default.employee.count({ where: { employmentType: 'MAGANG' } });
        // Contracts status counts
        const activeContracts = await prisma_1.default.contract.count({ where: { status: 'AKTIF' } });
        const expiringContracts = await prisma_1.default.contract.count({ where: { status: 'AKAN_BERAKHIR' } });
        const expiredContracts = await prisma_1.default.contract.count({ where: { status: 'EXPIRED' } });
        const extendedContracts = await prisma_1.default.contract.count({ where: { status: 'DIPERPANJANG' } });
        const resignContracts = await prisma_1.default.contract.count({ where: { status: 'RESIGN' } });
        // Overdue contracts (status is EXPIRED, excluding permanent PKWTT)
        const overdueContractsList = await prisma_1.default.contract.findMany({
            where: {
                status: 'EXPIRED',
                contractType: { not: 'PKWTT' },
            },
            include: {
                employee: true,
            },
            orderBy: { endDate: 'asc' },
        });
        // Upcoming expiring contracts in 30 days (status is AKAN_BERAKHIR, excluding permanent PKWTT)
        const expiring30DaysList = await prisma_1.default.contract.findMany({
            where: {
                status: 'AKAN_BERAKHIR',
                contractType: { not: 'PKWTT' },
            },
            include: {
                employee: true,
            },
            orderBy: { endDate: 'asc' },
        });
        return res.json({
            employees: {
                total: totalEmployees,
                pkwt: pkwtCount,
                pkwtt: pkwttCount,
                magang: magangCount,
            },
            contracts: {
                aktif: activeContracts,
                akanBerakhir: expiringContracts,
                expired: expiredContracts,
                diperpanjang: extendedContracts,
                resign: resignContracts,
            },
            overdueCount: overdueContractsList.length,
            overdueList: overdueContractsList,
            expiring30DaysCount: expiring30DaysList.length,
            expiring30DaysList: expiring30DaysList,
        });
    }
    catch (error) {
        console.error('Error fetching dashboard summary:', error);
        return res.status(500).json({ error: 'Gagal mengambil data ringkasan dashboard.' });
    }
});
// GET /api/dashboard/expiring-contracts?days=7|30|60|90
router.get('/expiring-contracts', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const today = new Date();
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + days);
        const contracts = await prisma_1.default.contract.findMany({
            where: {
                endDate: { gte: today, lte: futureDate },
                status: { in: ['AKTIF', 'AKAN_BERAKHIR'] },
                contractType: { not: 'PKWTT' },
            },
            include: {
                employee: true,
            },
            orderBy: { endDate: 'asc' },
        });
        return res.json({
            days,
            count: contracts.length,
            contracts,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil daftar kontrak yang akan berakhir.' });
    }
});
// GET /api/dashboard/charts
router.get('/charts', auth_1.authenticateJWT, (0, auth_1.requireRole)(['ADMIN', 'MANAGEMENT']), async (req, res) => {
    try {
        // Department Distribution
        const employees = await prisma_1.default.employee.findMany({
            select: { department: true, employmentType: true },
        });
        const deptMap = {};
        const typeMap = {};
        employees.forEach((emp) => {
            deptMap[emp.department] = (deptMap[emp.department] || 0) + 1;
            typeMap[emp.employmentType] = (typeMap[emp.employmentType] || 0) + 1;
        });
        const departmentData = Object.keys(deptMap).map((dept) => ({
            name: dept,
            value: deptMap[dept],
        }));
        const contractTypeData = Object.keys(typeMap).map((type) => ({
            name: type,
            value: typeMap[type],
        }));
        return res.json({
            departmentData,
            contractTypeData,
        });
    }
    catch (error) {
        return res.status(500).json({ error: 'Gagal mengambil data grafik dashboard.' });
    }
});
exports.default = router;
