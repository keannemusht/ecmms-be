export type EmployeeLevel = 'Director' | 'Manager' | 'Superintendent' | 'Supervisor' | 'Junior Supervisor' | 'Staff' | 'Worker';

export function determineEmployeeLevel(position: string = ''): 'Director' | 'Manager' | 'Superintendent' | 'Supervisor' | 'Junior Supervisor' | 'Worker' {
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

  // 3. Superintendent (NEW)
  if (
    pos.includes('superintendent') ||
    pos.includes('supt') ||
    pos.startsWith('si ') ||
    pos.includes(' si ') ||
    pos.endsWith(' si')
  ) {
    return 'Superintendent';
  }

  // 4. Supervisor (SPV)
  if (
    pos.includes('supervisor') ||
    pos.includes('spv') ||
    pos.includes('pengawas')
  ) {
    if (pos.includes('junior') || pos.includes('jr')) {
      return 'Junior Supervisor';
    }
    return 'Supervisor';
  }

  // 5. Worker (Replaces Non-Staff: Driver, Mechanic, Operator, Helper, Field support, etc.)
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
    pos.includes('kurir') ||
    pos.includes('worker') ||
    pos.includes('buruh')
  ) {
    return 'Worker';
  }

  // 6. Junior Supervisor (For Admin, Officer, Analyst, Magang, Dokter, etc.)
  return 'Junior Supervisor';
}

