"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWhatsAppMessage = buildWhatsAppMessage;
exports.buildWhatsAppLink = buildWhatsAppLink;
function normalizePhone(phone) {
    let digits = phone.replace(/[^0-9]/g, '');
    if (digits.startsWith('0')) {
        digits = '62' + digits.slice(1);
    }
    else if (digits.startsWith('8')) {
        digits = '62' + digits;
    }
    return digits;
}
function buildWhatsAppMessage(params) {
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
function buildWhatsAppLink(phone, message) {
    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone) {
        return '';
    }
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
