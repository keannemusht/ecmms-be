import nodemailer from 'nodemailer';
import { renderEmailTemplate } from './emailTemplate';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || (SMTP_HOST === 'smtp.gmail.com' ? '465' : '587'), 10);
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `ECMMS <${SMTP_USER}>` : 'no-reply@ecmms.local');

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

export interface EmailOptions {
  text?: string;
  template?: string;
  context?: Record<string, unknown>;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  // Prefer explicit SMTP config; fall back to Gmail app password (MAIL_USER/MAIL_PASS).
  const host = SMTP_HOST || (SMTP_USER && SMTP_PASS ? 'smtp.gmail.com' : '');
  if (!host) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(to: string, subject: string, content: string | EmailOptions): Promise<DeliveryResult> {
  const t = getTransporter();
  if (!t) {
    return { ok: false, error: 'SMTP tidak dikonfigurasi (SMTP_HOST kosong).' };
  }

  let text: string | undefined;
  let html: string | undefined;

  if (typeof content === 'string') {
    text = content;
  } else {
    text = content.text;
    if (content.template) {
      try {
        html = renderEmailTemplate(content.template, content.context || {});
      } catch (error: any) {
        return { ok: false, error: error?.message || String(error) };
      }
    }
  }

  try {
    await t.sendMail({ from: SMTP_FROM, to, subject, html, text });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}
