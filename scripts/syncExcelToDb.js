const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const prisma = require('../dist/prisma').default;
const { determineEmployeeLevel } = require('../dist/lib/employeeLevel');
const { normalizeEmployeeContractStatuses } = require('../dist/services/contractNormalizer');

const ADMIN_USER_ID = '1f44f6c0-f2ea-44ac-9e60-9cfd3dda29ad'; // Kemal Musthafa Rajabi

// Known typo / alias corrections from Excel to canonical DB NIK
const NRP_FIXES = {
  '88200220': '88250220', // Selamet Ariadi
  '85250334': '88250334', // Firzi Rizkiyawan
  '98250037': '98250337', // Rahman Taufiq
  '88450341': '88250341', // Syamsir B
  '88250023': '88250002', // Yanto Tabun
  '88250102': '88250029', // M. Taufik Ridho'i
};

function extractDate(cellValue) {
  if (!cellValue) return null;
  let dateObj = null;

  if (cellValue instanceof Date) {
    dateObj = cellValue;
  } else if (typeof cellValue === 'object') {
    if (cellValue.result instanceof Date) {
      dateObj = cellValue.result;
    } else if (cellValue.result) {
      dateObj = new Date(cellValue.result);
    } else if (cellValue.text) {
      dateObj = new Date(cellValue.text);
    }
  } else if (typeof cellValue === 'string') {
    const s = cellValue.trim();
    if (s && s !== '-') dateObj = new Date(s);
  } else if (typeof cellValue === 'number') {
    dateObj = new Date(Math.round((cellValue - 25569) * 86400 * 1000));
  }

  if (!dateObj || isNaN(dateObj.getTime())) return null;

  // Normalize to pure UTC date (YYYY-MM-DDT00:00:00.000Z) to avoid timezone shifts
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

function extractText(cellValue) {
  if (cellValue == null) return '';
  if (typeof cellValue === 'object') {
    if (cellValue.result != null) return String(cellValue.result).trim();
    if (cellValue.text != null) return String(cellValue.text).trim();
    if (cellValue.richText) return cellValue.richText.map(r => r.text).join('').trim();
  }
  return String(cellValue).trim();
}

function normalizeDepartment(dept) {
  if (!dept) return 'Operations';
  const d = dept.trim();
  const lower = d.toLowerCase();
  if (lower === 'produks' || lower === 'production' || lower === 'produksi') return 'Produksi';
  if (lower === 'operation' || lower === 'operations') return 'Operations';
  if (lower === 'logistik' || lower === 'logistic' || lower === 'log' || lower === 'logistik & purchasing') return 'Logistik';
  if (lower === 'hrga' || lower === 'hga') return 'HRGA';
  if (lower === 'man' || lower === 'bod') return 'BoD';
  if (lower === 'finance') return 'FA & Procurement';
  if (lower === 'plant') return 'Plant';
  if (lower === 'hse') return 'HSE';
  if (lower === 'infrastructure') return 'Infrastructure';
  return d;
}

function generateEmail(name, nrp) {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
  const suffix = (nrp || '').slice(-4) || Math.floor(1000 + Math.random() * 9000);
  return `${cleanName}.${suffix}@bataramining.com`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

async function main() {
  console.log('====================================================');
  console.log('   STARTING FULL PKWT SYNC: EXCEL -> POSTGRES DB    ');
  console.log('====================================================');

  const excelPath = path.join(__dirname, '../excel/Monitoring PKWT ALL.xlsx');
  if (!fs.existsSync(excelPath)) {
    console.error('File not found:', excelPath);
    process.exit(1);
  }

  // 1. BACKUP CURRENT DATABASE
  console.log('\n[Step 1] Creating database backup before synchronization...');
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const allCurrentEmployees = await prisma.employee.findMany({
    include: {
      contracts: true,
      user: { select: { id: true, email: true, name: true, role: true } }
    }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup_before_excel_sync_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(allCurrentEmployees, null, 2));
  console.log(`Backup saved: ${backupFile} (${(fs.statSync(backupFile).size / 1024).toFixed(1)} KB)`);

  // 2. PARSE EXCEL DATA
  console.log('\n[Step 2] Reading and parsing Excel file...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);

  const parsedRecords = [];
  const processedNiks = new Set();
  let duplicateCount = 0;

  for (const sheetName of ['Site', 'HO']) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    const isSite = sheetName === 'Site';
    const rowCount = ws.rowCount;
    console.log(`Reading sheet "${sheetName}" (${rowCount} rows)...`);

    for (let r = 5; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const nrpRaw = row.getCell(2).value;
      const namaRaw = row.getCell(3).value;

      if (!nrpRaw && !namaRaw) continue; // blank row

      let nrp = extractText(nrpRaw);
      const nama = extractText(namaRaw);

      if (!nama) continue;

      // Handle specific missing NRPs or typos
      if (!nrp && nama.toLowerCase().includes('azka pradhana')) {
        nrp = '99250355';
      } else if (!nrp && nama.toLowerCase().includes('i id machyan')) {
        nrp = '99250258';
      } else if (nama.toLowerCase().includes('suratno rahidin') && nrp === '98250122') {
        // Prevent collision with Masrudi Wirawadi Putra (98250122)
        nrp = '98250126';
      }

      if (NRP_FIXES[nrp]) {
        nrp = NRP_FIXES[nrp];
      }

      if (!nrp) {
        console.warn(`  [Warning] Skipping row ${r} in ${sheetName}: Name "${nama}" has no NRP.`);
        continue;
      }

      // Check duplicates (e.g. Sumardi duplicate in HO)
      if (processedNiks.has(nrp)) {
        duplicateCount++;
        continue;
      }
      processedNiks.add(nrp);

      const status = extractText(row.getCell(4).value);
      const jabatan = extractText(row.getCell(5).value);
      const dept = normalizeDepartment(extractText(row.getCell(6).value));
      const level = determineEmployeeLevel(jabatan);
      const site = isSite ? extractText(row.getCell(8).value) || 'Site' : 'HO';
      const doh = isSite ? extractDate(row.getCell(11).value) : extractDate(row.getCell(10).value);

      // Parse PKWT contracts
      const pkwtStartCol = isSite ? 12 : 11;
      const validContracts = [];

      for (let p = 0; p < 6; p++) {
        const seq = p + 1;
        const startCol = pkwtStartCol + (p * 2);
        const endCol = startCol + 1;

        const cellStart = row.getCell(startCol).value;
        const cellEnd = row.getCell(endCol).value;

        const startDate = extractDate(cellStart);
        const endDate = extractDate(cellEnd);

        // Only register contracts with both valid start and end dates
        if (startDate && endDate && endDate >= startDate) {
          validContracts.push({
            sequence: seq,
            startDate,
            endDate
          });
        }
      }

      parsedRecords.push({
        nrp,
        nama,
        status, // 'Exist' or 'Exit'
        jabatan,
        dept,
        level,
        site,
        joinDate: doh || (validContracts[0] ? validContracts[0].startDate : new Date('2025-01-01T00:00:00.000Z')),
        contracts: validContracts
      });
    }
  }

  console.log(`Parsed ${parsedRecords.length} unique employees from Excel (skipped ${duplicateCount} duplicate rows).`);

  // 3. SYNCHRONIZE WITH DATABASE
  console.log('\n[Step 3] Synchronizing employees and contracts into PostgreSQL...');
  const today = startOfToday();

  let employeesUpdated = 0;
  let employeesCreated = 0;
  let contractsCreated = 0;
  let contractsUpdated = 0;
  let contractsDeleted = 0;

  for (const record of parsedRecords) {
    const isExit = record.status.toLowerCase() === 'exit';

    // 3.1 Find or Create Employee
    let emp = await prisma.employee.findUnique({
      where: { nik: record.nrp },
      include: { contracts: { orderBy: { sequence: 'asc' } } }
    });

    if (emp) {
      // Update employee profile
      emp = await prisma.employee.update({
        where: { id: emp.id },
        data: {
          name: record.nama,
          department: record.dept,
          position: record.jabatan,
          level: record.level,
          joinDate: record.joinDate,
          updatedAt: new Date()
        },
        include: { contracts: { orderBy: { sequence: 'asc' } } }
      });
      employeesUpdated++;
    } else {
      // Create new employee
      const newEmail = generateEmail(record.nama, record.nrp);
      emp = await prisma.employee.create({
        data: {
          nik: record.nrp,
          name: record.nama,
          email: newEmail,
          department: record.dept,
          position: record.jabatan,
          level: record.level,
          employmentType: 'PKWT',
          joinDate: record.joinDate,
        },
        include: { contracts: { orderBy: { sequence: 'asc' } } }
      });
      employeesCreated++;
    }

    // 3.2 Synchronize Contracts
    const validContracts = record.contracts;
    const totalValid = validContracts.length;
    const existingContractsMap = new Map();
    emp.contracts.forEach(c => existingContractsMap.set(c.sequence, c));

    // A. Update or create contracts for valid sequences from Excel
    for (let i = 0; i < totalValid; i++) {
      const vc = validContracts[i];
      const isLatest = (i === totalValid - 1);

      let targetStatus = 'AKTIF';
      let targetNotes = 'Aktif';

      if (isExit) {
        targetStatus = 'RESIGN';
        targetNotes = 'Exit';
      } else {
        if (!isLatest) {
          targetStatus = 'AKTIF'; // Historical contract
          targetNotes = 'Aktif';
        } else {
          // Latest contract status
          const endDate = new Date(vc.endDate);
          endDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 3600 * 24));

          if (diffDays <= 0) {
            targetStatus = 'EXPIRED';
          } else if (diffDays <= 30) {
            targetStatus = 'AKAN_BERAKHIR';
          } else {
            targetStatus = 'AKTIF';
          }
        }
      }

      const existingContract = existingContractsMap.get(vc.sequence);
      if (existingContract) {
        // Update existing contract
        await prisma.contract.update({
          where: { id: existingContract.id },
          data: {
            startDate: vc.startDate,
            endDate: vc.endDate,
            status: targetStatus,
            notes: targetNotes,
            contractType: 'PKWT',
            updatedAt: new Date()
          }
        });
        contractsUpdated++;
      } else {
        // Create new contract
        await prisma.contract.create({
          data: {
            employeeId: emp.id,
            sequence: vc.sequence,
            contractType: 'PKWT',
            startDate: vc.startDate,
            endDate: vc.endDate,
            status: targetStatus,
            notes: targetNotes,
            createdById: ADMIN_USER_ID
          }
        });
        contractsCreated++;
      }
    }

    // B. Clean up extra obsolete contracts where sequence > totalValid
    // (e.g. if DB had 4 contracts but Excel only has 2 or 3)
    for (const ec of emp.contracts) {
      if (ec.sequence > totalValid && totalValid > 0) {
        if (isExit) {
          // If employee is Exit, mark extra contract as RESIGN
          await prisma.contract.update({
            where: { id: ec.id },
            data: { status: 'RESIGN', notes: 'Exit' }
          });
          contractsUpdated++;
        } else {
          // Remove obsolete extra sequence
          await prisma.contract.delete({ where: { id: ec.id } });
          contractsDeleted++;
        }
      }
    }

    // If employee is Exit and had no valid contracts in Excel, ensure all DB contracts are RESIGN
    if (isExit && totalValid === 0) {
      for (const ec of emp.contracts) {
        if (ec.status !== 'RESIGN') {
          await prisma.contract.update({
            where: { id: ec.id },
            data: { status: 'RESIGN', notes: 'Exit' }
          });
          contractsUpdated++;
        }
      }
    }
  }

  // 4. POST-SYNC NORMALIZATION
  console.log('\n[Step 4] Running global contract status normalization...');
  const normResult = await normalizeEmployeeContractStatuses();
  console.log(`Normalized ${normResult.employeesProcessed} employees (${normResult.contractsUpdated} contracts updated).`);

  // 5. FINAL STATS & SUMMARY
  console.log('\n====================================================');
  console.log('              SYNC COMPLETED SUCCESSFULLY!          ');
  console.log('====================================================');
  console.log(`Employees Updated       : ${employeesUpdated}`);
  console.log(`Employees Created (New) : ${employeesCreated}`);
  console.log(`Contracts Created       : ${contractsCreated}`);
  console.log(`Contracts Updated       : ${contractsUpdated}`);
  console.log(`Contracts Deleted       : ${contractsDeleted}`);

  const totalEmployeesNow = await prisma.employee.count();
  const totalContractsNow = await prisma.contract.count();
  const contractsByStatus = await prisma.contract.groupBy({
    by: ['status'],
    _count: true
  });

  console.log(`\nFinal Database Count:`);
  console.log(`Total Employees in DB   : ${totalEmployeesNow}`);
  console.log(`Total Contracts in DB   : ${totalContractsNow}`);
  console.log('Contracts Distribution by Status:');
  console.table(contractsByStatus.map(s => ({ Status: s.status, Count: s._count })));
}

main()
  .catch(err => {
    console.error('[Sync Failed]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
