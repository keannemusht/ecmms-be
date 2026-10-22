const ExcelJS = require('exceljs');
const prisma = require('../dist/prisma').default;

async function inspect() {
  const niks = ['88240001', '86240007', '88240011', '98250122', '88250005'];
  const emps = await prisma.employee.findMany({
    where: { nik: { in: niks } },
    include: { contracts: { orderBy: { sequence: 'asc' } } }
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('./excel/Monitoring PKWT ALL.xlsx');
  const ws = wb.getWorksheet('Site');

  for (const emp of emps) {
    console.log('==================================================');
    console.log('NIK:', emp.nik, '| DB Name:', emp.name);
    console.log('DB JoinDate:', emp.joinDate.toISOString().split('T')[0], '| Dept:', emp.department, '| Pos:', emp.position, '| Level:', emp.level);
    console.log('DB Contracts:');
    emp.contracts.forEach(c => {
      console.log(`  Seq ${c.sequence}: ${c.startDate.toISOString().split('T')[0]} to ${c.endDate.toISOString().split('T')[0]} [${c.status}] notes: ${c.notes}`);
    });

    // find in Excel
    for (let r = 5; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (String(row.getCell(2).value).trim() === emp.nik) {
        const doh = row.getCell(11).value;
        const dohStr = doh instanceof Date ? doh.toISOString().split('T')[0] : doh;
        console.log('Excel:', 'Nama:', row.getCell(3).value, '| Status:', row.getCell(4).value, '| Dept:', row.getCell(6).value, '| Pos:', row.getCell(5).value, '| Level:', row.getCell(7).value, '| DOH:', dohStr);
        for (let p = 1; p <= 6; p++) {
          const sc = 12 + (p - 1) * 2;
          const ec = sc + 1;
          const sv = row.getCell(sc).value;
          const ev = row.getCell(ec).value;
          if (sv || ev) {
            const sRes = sv?.result || sv;
            const eRes = ev?.result || ev;
            const sStr = sRes instanceof Date ? sRes.toISOString().split('T')[0] : sRes;
            const eStr = eRes instanceof Date ? eRes.toISOString().split('T')[0] : eRes;
            console.log(`  Excel PKWT ${p}: ${sStr} to ${eStr}`);
          }
        }
        break;
      }
    }
  }
}

inspect()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
