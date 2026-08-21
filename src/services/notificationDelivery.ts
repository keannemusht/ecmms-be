import 'dotenv/config';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { renderEmailTemplate } from './emailTemplate';

function getSmtpConfig() {
  const host = process.env.SMTP_HOST || (process.env.SMTP_USER || process.env.MAIL_USER ? 'smtp.gmail.com' : '');
  const port = parseInt(process.env.SMTP_PORT || (host === 'smtp.gmail.com' ? '465' : '587'), 10);
  const user = process.env.SMTP_USER || process.env.MAIL_USER || '';
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASS || '';
  const from = process.env.SMTP_FROM || (user ? `ECMMS <${user}>` : 'no-reply@ecmms.local');

  return { host, port, user, pass, from };
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

export interface EmailOptions {
  text?: string;
  template?: string;
  context?: Record<string, unknown>;
}

const LOGO_FILENAME = 'bbp_logo_202409_LeftAligment.png';

function resolveLogoFile(): string {
  const candidates = [
    path.join(__dirname, 'emailTemplates', LOGO_FILENAME),
    path.join(__dirname, LOGO_FILENAME),
    path.join(process.cwd(), 'src', 'services', 'emailTemplates', LOGO_FILENAME),
    path.join(process.cwd(), 'dist', 'services', 'emailTemplates', LOGO_FILENAME),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

/**
 * Resolves the email logo URL so it renders reliably across environments.
 * Priority: explicit EMAIL_LOGO_URL -> CID embedding (cid:logo).
 */
export function getEmailLogoUrl(): string {
  const explicit = process.env.EMAIL_LOGO_URL;
  if (explicit) return explicit;

  return 'cid:logo';
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): { transporter: nodemailer.Transporter | null; from: string } {
  const config = getSmtpConfig();
  if (!config.host) {
    return { transporter: null, from: config.from };
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    });
  }
  return { transporter, from: config.from };
}

export async function sendEmail(to: string, subject: string, content: string | EmailOptions): Promise<DeliveryResult> {
  const { transporter: t, from: smtpFrom } = getTransporter();
  if (!t) {
    return { ok: false, error: 'SMTP tidak dikonfigurasi (SMTP_HOST atau MAIL_USER/MAIL_PASS kosong).' };
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

  const attachments: nodemailer.SendMailOptions['attachments'] = [];
  if (html && html.includes('cid:logo')) {
    const logoPath = resolveLogoFile();
    if (logoPath) {
      attachments.push({
        filename: LOGO_FILENAME,
        path: logoPath,
        cid: 'logo',
      });
    }
  }

  try {
    await t.sendMail({ from: smtpFrom, to, subject, html, text, attachments });
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}
