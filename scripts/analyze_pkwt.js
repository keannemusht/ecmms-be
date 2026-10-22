const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// Connect to prisma via compiled dist
const prisma = require('../dist/prisma').default;

function extractDate(cellValue) {
  if (!cellValue) return null;
  if (cellValue instanceof Date) {
    if (isNaN(cellValue.getTime())) return null;
    return cellValue;
  }
  if (typeof cellValue === 'object') {
    if (cellValue.result) {
      if (cellValue.result instanceof Date) {
        if (!isNaN(cellValue.result.getTime())) return cellValue.result;
      } else {
        const parsed = new Date(cellValue.result);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
    if (cellValue.text) {
      const parsed = new Date(cellValue.text);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  if (typeof cellValue === 'string') {
    const s = cellValue.trim();
    if (!s) return null;
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (typeof cellValue === 'number') {
    // Excel serial number
    const d = new Date(Math.round((cellValue - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
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

function formatDate(d) {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Starting PKWT Excel vs DB Analysis ===');
  const excelPath = path.join(__dirname, '../excel/Monitoring PKWT ALL.xlsx');
  
  if (!fs.existsSync(excelPath)) {
    console.error('File not found:', excelPath);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  console.log('Excel file loaded successfully.');

  // 1. Fetch all DB data
  console.log('Fetching database records...');
  const dbEmployees = await prisma.employee.findMany({
    include: {
      contracts: {
        orderBy: [{ sequence: 'asc' }, { startDate: 'asc' }]
      }
    }
  });
  console.log(`Found ${dbEmployees.length} employees in Database.`);

  const dbEmpByNik = new Map();
  for (const emp of dbEmployees) {
    const cleanNik = String(emp.nik).trim();
    dbEmpByNik.set(cleanNik, emp);
  }

  // 2. Parse Excel records
  const excelRecords = [];
  const duplicateNiksInExcel = [];
  const seenExcelNiks = new Map();
  const excelDataErrors = [];

  for (const sheetName of ['Site', 'HO']) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      console.warn(`Worksheet ${sheetName} not found!`);
      continue;
    }

    const isSite = sheetName === 'Site';
    const rowCount = ws.rowCount;
    console.log(`Parsing sheet: ${sheetName} (${rowCount} rows)`);

    for (let r = 5; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const nrpRaw = row.getCell(2).value;
      const namaRaw = row.getCell(3).value;

      if (!nrpRaw && !namaRaw) continue; // empty row

      const nrp = extractText(nrpRaw);
      const nama = extractText(namaRaw);

      if (!nrp) {
        excelDataErrors.push({
          sheet: sheetName,
          row: r,
          type: 'MISSING_NRP',
          nama: nama,
          details: 'Row has name but NRP is empty'
        });
        continue;
      }

      const status = extractText(row.getCell(4).value);
      const jabatan = extractText(row.getCell(5).value);
      const dept = extractText(row.getCell(6).value);
      const level = extractText(row.getCell(7).value);
      
      let site = isSite ? extractText(row.getCell(8).value) : 'HO';
      let tempatLahir = isSite ? extractText(row.getCell(9).value) : extractText(row.getCell(8).value);
      let tglLahir = isSite ? extractDate(row.getCell(10).value) : extractDate(row.getCell(9).value);
      let doh = isSite ? extractDate(row.getCell(11).value) : extractDate(row.getCell(10).value);
      
      // PKWT columns start at col 12 for Site, col 11 for HO
      const pkwtStartCol = isSite ? 12 : 11;
      const contracts = [];

      for (let p = 0; p < 6; p++) {
        const seq = p + 1;
        const startCol = pkwtStartCol + (p * 2);
        const endCol = startCol + 1;

        const cellStart = row.getCell(startCol).value;
        const cellEnd = row.getCell(endCol).value;

        const startDate = extractDate(cellStart);
        const endDate = extractDate(cellEnd);

        // Check for anomalies
        if (cellStart && !startDate) {
          excelDataErrors.push({
            sheet: sheetName,
            row: r,
            nrp,
            nama,
            type: 'INVALID_START_DATE_FORMAT',
            details: `PKWT ${seq} Start cell raw value: ${JSON.stringify(cellStart)}`
          });
        }
        if (cellEnd && !endDate) {
          excelDataErrors.push({
            sheet: sheetName,
            row: r,
            nrp,
            nama,
            type: 'INVALID_END_DATE_FORMAT',
            details: `PKWT ${seq} End cell raw value: ${JSON.stringify(cellEnd)}`
          });
        }

        if (startDate || endDate) {
          if (startDate && !endDate) {
            excelDataErrors.push({
              sheet: sheetName,
              row: r,
              nrp,
              nama,
              type: 'MISSING_END_DATE',
              details: `PKWT ${seq} has Start Date (${formatDate(startDate)}) but End Date is missing`
            });
          }
          if (!startDate && endDate) {
            excelDataErrors.push({
              sheet: sheetName,
              row: r,
              nrp,
              nama,
              type: 'MISSING_START_DATE',
              details: `PKWT ${seq} has End Date (${formatDate(endDate)}) but Start Date is missing`
            });
          }
          if (startDate && endDate && endDate < startDate) {
            excelDataErrors.push({
              sheet: sheetName,
              row: r,
              nrp,
              nama,
              type: 'END_DATE_BEFORE_START',
              details: `PKWT ${seq} End (${formatDate(endDate)}) is earlier than Start (${formatDate(startDate)})`
            });
          }

          contracts.push({
            seq,
            startDate: formatDate(startDate),
            endDate: formatDate(endDate),
            rawStart: cellStart,
            rawEnd: cellEnd
          });
        }
      }

      // Check duplicates in Excel
      if (seenExcelNiks.has(nrp)) {
        duplicateNiksInExcel.push({
          nrp,
          nama,
          sheet: sheetName,
          row: r,
          previous: seenExcelNiks.get(nrp)
        });
      } else {
        seenExcelNiks.set(nrp, { sheet: sheetName, row: r, nama });
      }

      excelRecords.push({
        sheet: sheetName,
        row: r,
        nrp,
        nama,
        status,
        jabatan,
        dept,
        level,
        site,
        tempatLahir,
        tglLahir: formatDate(tglLahir),
        doh: formatDate(doh),
        contracts
      });
    }
  }

  console.log(`Parsed ${excelRecords.length} records from Excel.`);

  // 3. Comparison
  const onlyInExcel = [];
  const onlyInDb = [];
  const matching = [];

  const statusInconsistencies = [];
  const profileMismatches = [];
  const contractUpdates = [];
  const contractMismatches = [];

  const excelNiks = new Set(excelRecords.map(r => r.nrp));

  // Find DB records not in Excel
  for (const emp of dbEmployees) {
    const cleanNik = String(emp.nik).trim();
    if (!excelNiks.has(cleanNik)) {
      onlyInDb.push({
        nik: cleanNik,
        name: emp.name,
        department: emp.department,
        position: emp.position,
        employmentType: emp.employmentType,
        contractsCount: emp.contracts.length,
        latestContract: emp.contracts[emp.contracts.length - 1] ? {
          seq: emp.contracts[emp.contracts.length - 1].sequence,
          startDate: formatDate(emp.contracts[emp.contracts.length - 1].startDate),
          endDate: formatDate(emp.contracts[emp.contracts.length - 1].endDate),
          status: emp.contracts[emp.contracts.length - 1].status
        } : null
      });
    }
  }

  // Find Excel records and compare
  for (const xRec of excelRecords) {
    const dbEmp = dbEmpByNik.get(xRec.nrp);

    if (!dbEmp) {
      onlyInExcel.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        dept: xRec.dept,
        jabatan: xRec.jabatan,
        status: xRec.status,
        site: xRec.sheet,
        contractsCount: xRec.contracts.length,
        contracts: xRec.contracts
      });
      continue;
    }

    matching.push({ nrp: xRec.nrp, nama: xRec.nama });

    // Compare Profile Fields
    const pDiff = [];
    if (xRec.nama.toLowerCase() !== dbEmp.name.toLowerCase().trim()) {
      pDiff.push({ field: 'name', excel: xRec.nama, db: dbEmp.name });
    }
    if (xRec.dept && xRec.dept.toLowerCase() !== dbEmp.department.toLowerCase().trim()) {
      pDiff.push({ field: 'department', excel: xRec.dept, db: dbEmp.department });
    }
    if (xRec.jabatan && xRec.jabatan.toLowerCase() !== dbEmp.position.toLowerCase().trim()) {
      pDiff.push({ field: 'position', excel: xRec.jabatan, db: dbEmp.position });
    }
    if (xRec.level && dbEmp.level && xRec.level.toLowerCase() !== dbEmp.level.toLowerCase().trim()) {
      pDiff.push({ field: 'level', excel: xRec.level, db: dbEmp.level });
    }
    if (xRec.doh && formatDate(dbEmp.joinDate) && xRec.doh !== formatDate(dbEmp.joinDate)) {
      pDiff.push({ field: 'joinDate', excel: xRec.doh, db: formatDate(dbEmp.joinDate) });
    }

    if (pDiff.length > 0) {
      profileMismatches.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        differences: pDiff
      });
    }

    // Compare Status (Exist vs Exit)
    const isExitExcel = xRec.status.toLowerCase() === 'exit';
    const isExistExcel = xRec.status.toLowerCase() === 'exist';
    const hasActiveContractInDb = dbEmp.contracts.some(c => c.status === 'AKTIF' || c.status === 'AKAN_BERAKHIR');
    const isAllResignedInDb = dbEmp.contracts.length > 0 && dbEmp.contracts.every(c => c.status === 'RESIGN');

    if (isExitExcel && hasActiveContractInDb) {
      statusInconsistencies.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        type: 'EXCEL_EXIT_BUT_DB_ACTIVE',
        details: 'Excel status is EXIT, but DB has contract with AKTIF or AKAN_BERAKHIR status',
        dbContracts: dbEmp.contracts.map(c => ({ seq: c.sequence, status: c.status, end: formatDate(c.endDate) }))
      });
    } else if (isExistExcel && isAllResignedInDb) {
      statusInconsistencies.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        type: 'EXCEL_EXIST_BUT_DB_RESIGN',
        details: 'Excel status is EXIST, but DB has all contracts marked as RESIGN',
        dbContracts: dbEmp.contracts.map(c => ({ seq: c.sequence, status: c.status, end: formatDate(c.endDate) }))
      });
    }

    // Compare Contracts
    const xContracts = xRec.contracts;
    const dbContracts = dbEmp.contracts;

    // Check for new contract sequences in Excel not in DB
    if (xContracts.length > dbContracts.length) {
      const newInExcel = xContracts.slice(dbContracts.length);
      contractUpdates.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        type: 'NEW_CONTRACT_IN_EXCEL',
        excelCount: xContracts.length,
        dbCount: dbContracts.length,
        newContracts: newInExcel
      });
    } else if (xContracts.length < dbContracts.length) {
      contractMismatches.push({
        nrp: xRec.nrp,
        nama: xRec.nama,
        type: 'MORE_CONTRACTS_IN_DB_THAN_EXCEL',
        excelCount: xContracts.length,
        dbCount: dbContracts.length,
        dbExtra: dbContracts.slice(xContracts.length).map(c => ({ seq: c.sequence, start: formatDate(c.startDate), end: formatDate(c.endDate), status: c.status }))
      });
    }

    // Compare overlapping contract sequences
    const minLen = Math.min(xContracts.length, dbContracts.length);
    for (let i = 0; i < minLen; i++) {
      const xc = xContracts[i];
      const dc = dbContracts[i];

      const startMatch = !xc.startDate || !dc.startDate || xc.startDate === formatDate(dc.startDate);
      const endMatch = !xc.endDate || !dc.endDate || xc.endDate === formatDate(dc.endDate);

      if (!startMatch || !endMatch) {
        contractMismatches.push({
          nrp: xRec.nrp,
          nama: xRec.nama,
          seq: i + 1,
          type: 'DATE_MISMATCH',
          excel: { start: xc.startDate, end: xc.endDate },
          db: { start: formatDate(dc.startDate), end: formatDate(dc.endDate), status: dc.status }
        });
      }
    }
  }

  // Summary statistics
  const report = {
    summary: {
      dbTotalEmployees: dbEmployees.length,
      excelTotalRecords: excelRecords.length,
      excelSiteRecords: excelRecords.filter(r => r.sheet === 'Site').length,
      excelHoRecords: excelRecords.filter(r => r.sheet === 'HO').length,
      matchingEmployeesCount: matching.length,
      onlyInExcelCount: onlyInExcel.length,
      onlyInDbCount: onlyInDb.length,
      duplicateNiksInExcelCount: duplicateNiksInExcel.length,
      excelDataErrorsCount: excelDataErrors.length,
      statusInconsistenciesCount: statusInconsistencies.length,
      profileMismatchesCount: profileMismatches.length,
      newContractUpdatesInExcelCount: contractUpdates.length,
      contractDateMismatchesCount: contractMismatches.filter(m => m.type === 'DATE_MISMATCH').length,
      moreContractsInDbCount: contractMismatches.filter(m => m.type === 'MORE_CONTRACTS_IN_DB_THAN_EXCEL').length,
    },
    onlyInExcel,
    onlyInDb,
    duplicateNiksInExcel,
    excelDataErrors,
    statusInconsistencies,
    profileMismatches,
    contractUpdates,
    contractMismatches
  };

  const outputPath = path.join(__dirname, 'analysis_result.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log('Analysis complete! Result saved to:', outputPath);
  console.log('SUMMARY:', JSON.stringify(report.summary, null, 2));
}

main()
  .catch(err => {
    console.error('Analysis failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
