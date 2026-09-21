import 'dotenv/config';
import prisma from '../prisma';
import { determineEmployeeLevel } from '../lib/employeeLevel';

async function main() {
  console.log('[Update Employee Levels] Starting position-based level synchronization...');

  // 1. Convert any explicit 'Non-Staff' to 'Worker' directly
  const nonStaffRes = await prisma.employee.updateMany({
    where: { level: 'Non-Staff' },
    data: { level: 'Worker' },
  });
  console.log(`Converted ${nonStaffRes.count} employees from 'Non-Staff' to 'Worker'.`);

  // 2. Process all unique positions
  const employees = await prisma.employee.findMany({
    select: {
      position: true,
    },
  });

  console.log(`Found ${employees.length} total employees.`);

  const uniquePositions = [...new Set(employees.map((e) => e.position || ''))];
  console.log(`Found ${uniquePositions.length} unique positions to process.`);

  let totalUpdated = 0;
  for (const pos of uniquePositions) {
    const targetLevel = determineEmployeeLevel(pos);
    const res = await prisma.employee.updateMany({
      where: {
        position: pos,
        level: { not: targetLevel },
      },
      data: {
        level: targetLevel,
      },
    });

    if (res.count > 0) {
      console.log(`Updated position "${pos}" -> ${targetLevel} (${res.count} employees)`);
      totalUpdated += res.count;
    }
  }

  // 3. Update ContractEvaluation records with 'Non-Staff'
  const evRes = await prisma.contractEvaluation.updateMany({
    where: { employeeLevel: 'Non-Staff' },
    data: { employeeLevel: 'Worker' },
  });
  console.log(`Updated ${evRes.count} ContractEvaluation records from 'Non-Staff' to 'Worker'.`);

  console.log(`\nTotal employee level updates executed: ${totalUpdated}`);

  // Summary counts
  const summary = await prisma.employee.groupBy({
    by: ['level'],
    _count: {
      id: true,
    },
  });

  console.log('\nFinal distribution by level:');
  console.table(summary.map((s) => ({ level: s.level, count: s._count.id })));
}

main()
  .catch((err) => {
    console.error('[Update Failed]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
