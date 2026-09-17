import crypto from 'crypto';
import { sendEmail, getEmailLogoUrl } from './notificationDelivery';
import { buildWhatsAppLink } from './whatsappNotification';

export interface EvaluationInviteParams {
  evaluatorName: string;
  evaluatorPosition?: string;
  evaluatorEmail?: string;
  evaluatorPhone?: string;
  employeeName: string;
  employeeNik: string;
  department: string;
  position: string;
  endDate: string | Date;
  accessToken: string;
  frontendBaseUrl?: string;
}

export function generateEvaluationToken(): string {
  return crypto.randomUUID();
}

export function getEvaluationUrl(accessToken: string, customBaseUrl?: string): string {
  const base = customBaseUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/evaluate/${accessToken}`;
}

export function buildEvaluationWhatsAppMessage(params: EvaluationInviteParams): string {
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

export function buildEvaluationWhatsAppUrl(phone: string | undefined, params: EvaluationInviteParams): string {
  const message = buildEvaluationWhatsAppMessage(params);
  return buildWhatsAppLink(phone || '', message);
}

export async function sendEvaluationInviteEmail(params: EvaluationInviteParams): Promise<{ ok: boolean; error?: string }> {
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
    logoUrl: getEmailLogoUrl(),
  };

  const subject = `[Evaluasi Kontrak] Penilaian Kinerja Karyawan: ${params.employeeName} (${params.employeeNik})`;

  return sendEmail(params.evaluatorEmail, subject, {
    template: 'evaluation_invite',
    context,
  });
}
