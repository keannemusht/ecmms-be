export function determineEmployeeLevel(position: string = ''): 'Director' | 'Manager' | 'Staff' | 'Non-Staff' {
  const pos = (position || '').trim().toLowerCase();

  // 1. Director
  if (
    pos.includes('director') ||
    pos.includes('direktur') ||
    pos.includes('commisaris') ||
    pos.includes('komisaris')
  ) {
    return 'Director';
  }

  // 2. Manager
  if (
    pos.includes('manager') ||
    pos.includes('pjo') ||
    pos.includes('kepala divisi') ||
    pos.includes('kadiv') ||
    pos.includes('general manager') ||
    pos.includes('gm ') ||
    pos.endsWith(' gm')
  ) {
    return 'Manager';
  }

  // 3. Non-Staff (Driver, Mechanic, Operator, Helper, Field support, etc.)
  if (
    pos.includes('driver') ||
    pos.includes('sopir') ||
    pos.includes('mechanic') ||
    pos.includes('mekanik') ||
    pos.includes('tyreman') ||
    pos.includes('fuelman') ||
    pos.includes('welder') ||
    pos.includes('helper') ||
    pos.includes('spotter') ||
    pos.includes('electrician') ||
    pos.includes('office boy') ||
    pos.includes('ob') ||
    pos.includes('cleaning') ||
    pos.includes('tools keeper') ||
    pos.includes('operator') ||
    pos.includes('security') ||
    pos.includes('satpam') ||
    pos.includes('patrol') ||
    pos.includes('kurir')
  ) {
    return 'Non-Staff';
  }

  // 4. Staff (SPV, Superintendent, Admin, Officer, Dokter, Magang, etc.)
  return 'Staff';
}
