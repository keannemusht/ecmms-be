"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = __importDefault(require("../prisma"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/search/quick?q=...
router.get('/quick', auth_1.authenticateJWT, async (req, res) => {
    try {
        const q = req.query.q ? String(req.query.q).trim() : '';
        if (!q || q.length < 1) {
            return res.json({ employees: [], contracts: [], evaluations: [] });
        }
        const isUser = req.user?.role === 'USER';
        const userEmployeeId = req.user?.employeeId;
        if (isUser && !userEmployeeId) {
            return res.json({ employees: [], contracts: [], evaluations: [] });
        }
        // 1. Search Employees
        const empWhere = isUser && userEmployeeId
            ? {
                id: userEmployeeId,
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { nik: { contains: q, mode: 'insensitive' } },
                ],
            }
            : {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { nik: { contains: q, mode: 'insensitive' } },
                    { position: { contains: q, mode: 'insensitive' } },
                    { department: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } },
                    { phone: { contains: q, mode: 'insensitive' } },
                    {
                        contracts: {
                            some: {
                                contractNumber: { contains: q, mode: 'insensitive' },
                            },
                        },
                    },
                ],
            };
        // 2. Search Contracts
        const contractWhere = isUser && userEmployeeId
            ? {
                employeeId: userEmployeeId,
                OR: [
                    { contractNumber: { contains: q, mode: 'insensitive' } },
                    { notes: { contains: q, mode: 'insensitive' } },
                ],
            }
            : {
                OR: [
                    { contractNumber: { contains: q, mode: 'insensitive' } },
                    { employee: { name: { contains: q, mode: 'insensitive' } } },
                    { employee: { nik: { contains: q, mode: 'insensitive' } } },
                    { employee: { department: { contains: q, mode: 'insensitive' } } },
                    { employee: { position: { contains: q, mode: 'insensitive' } } },
                    { notes: { contains: q, mode: 'insensitive' } },
                ],
            };
        // 3. Search Evaluations (ADMIN / MANAGEMENT only)
        const canViewEvaluations = req.user?.role === 'ADMIN' || req.user?.role === 'MANAGEMENT';
        const [employees, contracts, evaluations] = await Promise.all([
            prisma_1.default.employee.findMany({
                where: empWhere,
                select: {
                    id: true,
                    nik: true,
                    name: true,
                    department: true,
                    position: true,
                    level: true,
                    employmentType: true,
                    contracts: {
                        orderBy: { sequence: 'desc' },
                        take: 1,
                        select: {
                            id: true,
                            contractNumber: true,
                            status: true,
                            sequence: true,
                            endDate: true,
                        },
                    },
                },
                orderBy: { name: 'asc' },
                take: 6,
            }),
            prisma_1.default.contract.findMany({
                where: contractWhere,
                select: {
                    id: true,
                    contractNumber: true,
                    status: true,
                    contractType: true,
                    startDate: true,
                    endDate: true,
                    sequence: true,
                    employee: {
                        select: {
                            id: true,
                            name: true,
                            nik: true,
                            department: true,
                            position: true,
                        },
                    },
                },
                orderBy: { endDate: 'desc' },
                take: 5,
            }),
            canViewEvaluations
                ? prisma_1.default.contractEvaluation.findMany({
                    where: {
                        OR: [
                            { documentNumber: { contains: q, mode: 'insensitive' } },
                            { employee: { name: { contains: q, mode: 'insensitive' } } },
                            { employee: { nik: { contains: q, mode: 'insensitive' } } },
                            { employee: { department: { contains: q, mode: 'insensitive' } } },
                        ],
                    },
                    select: {
                        id: true,
                        documentNumber: true,
                        ratingGrade: true,
                        recommendationType: true,
                        evaluationDate: true,
                        employee: {
                            select: {
                                id: true,
                                name: true,
                                department: true,
                                position: true,
                            },
                        },
                    },
                    orderBy: { evaluationDate: 'desc' },
                    take: 3,
                })
                : Promise.resolve([]),
        ]);
        return res.json({
            employees,
            contracts,
            evaluations,
        });
    }
    catch (error) {
        console.error('Error in quick search:', error);
        return res.status(500).json({ error: 'Gagal melakukan pencarian.' });
    }
});
exports.default = router;
