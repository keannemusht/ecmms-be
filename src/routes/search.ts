import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { Prisma } from '@prisma/client';

const router = Router();

// GET /api/search/quick?q=...
router.get('/quick', authenticateJWT, async (req: AuthRequest, res: Response) => {
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
    const empWhere: Prisma.EmployeeWhereInput = isUser && userEmployeeId
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
    const contractWhere: Prisma.ContractWhereInput = isUser && userEmployeeId
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
      prisma.employee.findMany({
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
      prisma.contract.findMany({
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
        ? prisma.contractEvaluation.findMany({
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
  } catch (error) {
    console.error('Error in quick search:', error);
    return res.status(500).json({ error: 'Gagal melakukan pencarian.' });
  }
});

export default router;
