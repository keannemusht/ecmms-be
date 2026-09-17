function normalizePhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    digits = '62' + digits;
  }
  return digits;
}

export function buildWhatsAppMessage(params: {
  title: string;
  heading: string;
  message: string;
  contract: {
    employee: { name: string };
    contractNumber?: string | null;
    endDate: Date | string;
  };
  footerText?: string;
}): string {
  const endDate = new Date(params.contract.endDate).toISOString().split('T')[0];
  const lines = [
    `*${params.title}*`,
    `*${params.heading}*`,
    '',
    params.message,
    '',
    `Karyawan: ${params.contract.employee.name}`,
    `No. Kontrak: ${params.contract.contractNumber || '-'}`,
    `Tanggal Berakhir: ${endDate}`,
    '',
    params.footerText || 'Pesan ini dikirim otomatis oleh sistem monitoring kontrak PKWT.',
  ];
  return lines.join('\n');
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const cleanPhone = normalizePhone(phone || '');
  if (!cleanPhone) {
    return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
