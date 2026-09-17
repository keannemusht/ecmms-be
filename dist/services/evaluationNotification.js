"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEvaluationToken = generateEvaluationToken;
exports.getEvaluationUrl = getEvaluationUrl;
exports.buildEvaluationWhatsAppMessage = buildEvaluationWhatsAppMessage;
exports.buildEvaluationWhatsAppUrl = buildEvaluationWhatsAppUrl;
exports.sendEvaluationInviteEmail = sendEvaluationInviteEmail;
const crypto_1 = __importDefault(require("crypto"));
const notificationDelivery_1 = require("./notificationDelivery");
const whatsappNotification_1 = require("./whatsappNotification");
function generateEvaluationToken() {
    return crypto_1.default.randomUUID();
}
function getEvaluationUrl(accessToken, customBaseUrl) {
    const base = customBaseUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    return `${base.replace(/\/+$/, '')}/evaluate/${accessToken}`;
}
function buildEvaluationWhatsAppMessage(params) {
    const evaluationUrl = getEvaluationUrl(params.accessToken, params.frontendBaseUrl);
    const formattedDate = new Date(params.endDate).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    return [
        `*PEMBERITAHUAN EVALUASI KONTRAK PKWT*`,
        `*PT BATARA DHARMA PERSADA*`,
        ``,
        `Yth. Bpk/Ibu *${params.evaluatorName}*${params.evaluatorPosition ? ` (${params.evaluatorPosition})` : ''},`,
        ``,
        `Kontrak kerja anggota tim Anda berikut akan segera berakhir:`,
        `• *Nama*: ${params.employeeName}`,
        `• *NIK*: ${params.employeeNik}`,
        `• *Departemen*: ${params.department}`,
        `• *Posisi*: ${params.position}`,
        `• *Berakhir*: ${formattedDate}`,
        ``,
        `Mohon kesediaannya mengisi form evaluasi kinerja online via tautan berikut:`,
        `👉 ${evaluationUrl}`,
        ``,
        `_Catatan: Pengisian hanya membutuhkan ±2-3 menit dari HP/laptop. Setelah selesai, Anda dapat langsung mencetak formulir resmi 1 lembar A4 untuk tanda tangan basah berjenjang._`,
        ``,
        `Terima kasih.`,
        `*HRD PT Batara Dharma Persada*`,
    ].join('\n');
}
function buildEvaluationWhatsAppUrl(phone, params) {
    const message = buildEvaluationWhatsAppMessage(params);
    return (0, whatsappNotification_1.buildWhatsAppLink)(phone || '', message);
}
async function sendEvaluationInviteEmail(params) {
    if (!params.evaluatorEmail) {
        return { ok: false, error: 'Email penilai tidak diisi.' };
    }
    const evaluationUrl = getEvaluationUrl(params.accessToken, params.frontendBaseUrl);
    const endDateFormatted = new Date(params.endDate).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    const context = {
        evaluatorName: params.evaluatorName,
        evaluatorPosition: params.evaluatorPosition || 'Atasan Langsung',
        employeeName: params.employeeName,
        employeeNik: params.employeeNik,
        department: params.department,
        position: params.position,
        endDateFormatted,
        evaluationUrl,
        logoUrl: (0, notificationDelivery_1.getEmailLogoUrl)(),
    };
    const subject = `[Evaluasi Kontrak] Penilaian Kinerja Karyawan: ${params.employeeName} (${params.employeeNik})`;
    return (0, notificationDelivery_1.sendEmail)(params.evaluatorEmail, subject, {
        template: 'evaluation_invite',
        context,
    });
}
