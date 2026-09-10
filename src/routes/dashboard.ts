import { Router, Response } from 'express';
import prisma from '../prisma';
import { authenticateJWT, AuthRequest, requireRole } from '../middleware/auth';
import { normalizeEmployeeContractStatuses } from '../services/contractNormalizer';

const router = Router();

// GET /api/dashboard/summary
router.get('/summary', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    // Ensure contracts are normalized before summarizing
    await normalizeEmployeeContractStatuses();

    const today = new Date();

    // Counts by Employment Type
    const totalEmployees = await prisma.employee.count();
    const pkwtCount = await prisma.employee.count({ where: { employmentType: 'PKWT' } });
    const pkwttCount = await prisma.employee.count({ where: { employmentType: 'PKWTT' } });
    const magangCount = await prisma.employee.count({ where: { employmentType: 'MAGANG' } });

    // Contracts status counts
    const activeContracts = await prisma.contract.count({ where: { status: 'AKTIF' } });
    const expiringContracts = await prisma.contract.count({ where: { status: 'AKAN_BERAKHIR' } });
    const expiredContracts = await prisma.contract.count({ where: { status: 'EXPIRED' } });
    const extendedContracts = await prisma.contract.count({ where: { status: 'DIPERPANJANG' } });
    const resignContracts = await prisma.contract.count({ where: { status: 'RESIGN' } });

    // Overdue contracts (status is EXPIRED, excluding permanent PKWTT)
    const overdueContractsList = await prisma.contract.findMany({
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
    const expiring30DaysList = await prisma.contract.findMany({
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
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return res.status(500).json({ error: 'Gagal mengambil data ringkasan dashboard.' });
  }
});

// GET /api/dashboard/expiring-contracts?days=7|30|60|90
router.get('/expiring-contracts', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + days);

    const contracts = await prisma.contract.findMany({
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
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil daftar kontrak yang akan berakhir.' });
  }
});

// GET /api/dashboard/charts
router.get('/charts', authenticateJWT, requireRole(['ADMIN', 'MANAGEMENT']), async (req: AuthRequest, res: Response) => {
  try {
    // Department Distribution
    const employees = await prisma.employee.findMany({
      select: { department: true, employmentType: true },
    });

    const deptMap: Record<string, number> = {};
    const typeMap: Record<string, number> = {};

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
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil data grafik dashboard.' });
  }
});

export default router;
