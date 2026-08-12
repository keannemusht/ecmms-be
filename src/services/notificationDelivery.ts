import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
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

const LOGO_FILENAME = 'bbp_logo_202409_LeftAligment.png';

let cachedLogoDataUri: string | null = null;

function resolveLogoFile(): string {
  const candidates = [
    path.join(__dirname, 'emailTemplates', LOGO_FILENAME),
    path.join(process.cwd(), 'src/services/emailTemplates', LOGO_FILENAME),
    path.join(process.cwd(), 'dist/services/emailTemplates', LOGO_FILENAME),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

/**
 * Resolves the email logo URL so it renders reliably across environments.
 * Priority: explicit EMAIL_LOGO_URL -> backend-served asset (Vercel/base URL)
 * -> frontend public URL -> embedded base64 data URI.
 */
export function getEmailLogoUrl(): string {
  const explicit = process.env.EMAIL_LOGO_URL;
  if (explicit) return explicit;

  const base = process.env.EMAIL_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}` : '');
  if (base) return `${base.replace(/\/+$/, '')}/email-assets/${LOGO_FILENAME}`;

  const frontend = process.env.FRONTEND_URL;
  if (frontend && !/localhost|127\.0\.0\.1/.test(frontend)) {
    return `${frontend.replace(/\/+$/, '')}/img/${LOGO_FILENAME}`;
  }

  if (cachedLogoDataUri !== null) return cachedLogoDataUri;
  const logoPath = resolveLogoFile();
  if (logoPath) {
    try {
      cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
      return cachedLogoDataUri;
    } catch (error) {
      console.warn('[Email] Failed to read logo file for embedding:', error);
    }
  }
  return '';
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
