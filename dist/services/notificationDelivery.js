"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmailLogoUrl = getEmailLogoUrl;
exports.sendEmail = sendEmail;
require("dotenv/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const emailTemplate_1 = require("./emailTemplate");
function getSmtpConfig() {
    const host = process.env.SMTP_HOST || (process.env.SMTP_USER || process.env.MAIL_USER ? 'smtp.gmail.com' : '');
    const port = parseInt(process.env.SMTP_PORT || (host === 'smtp.gmail.com' ? '465' : '587'), 10);
    const user = process.env.SMTP_USER || process.env.MAIL_USER || '';
    const pass = process.env.SMTP_PASS || process.env.MAIL_PASS || '';
    const from = process.env.SMTP_FROM || (user ? `ECMMS <${user}>` : 'no-reply@ecmms.local');
    return { host, port, user, pass, from };
}
const LOGO_FILENAME = 'bbp_logo_202409_LeftAligment.png';
function resolveLogoFile() {
    const candidates = [
        path_1.default.join(__dirname, 'emailTemplates', LOGO_FILENAME),
        path_1.default.join(process.cwd(), 'src/services/emailTemplates', LOGO_FILENAME),
        path_1.default.join(process.cwd(), 'dist/services/emailTemplates', LOGO_FILENAME),
    ];
    return candidates.find((p) => fs_1.default.existsSync(p)) || '';
}
/**
 * Resolves the email logo URL so it renders reliably across environments.
 * Priority: explicit EMAIL_LOGO_URL -> backend-served asset (Vercel/base URL)
 * -> frontend public URL -> embedded base64 data URI.
 */
function getEmailLogoUrl() {
    const explicit = process.env.EMAIL_LOGO_URL;
    if (explicit)
        return explicit;
    const base = process.env.EMAIL_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}` : '');
    if (base)
        return `${base.replace(/\/+$/, '')}/email-assets/${LOGO_FILENAME}`;
    const frontend = process.env.FRONTEND_URL;
    if (frontend && !/localhost|127\.0\.0\.1/.test(frontend)) {
        return `${frontend.replace(/\/+$/, '')}/img/${LOGO_FILENAME}`;
    }
    return 'cid:logo';
}
let transporter = null;
function getTransporter() {
    const config = getSmtpConfig();
    if (!config.host) {
        return { transporter: null, from: config.from };
    }
    if (!transporter) {
        transporter = nodemailer_1.default.createTransport({
            host: config.host,
            port: config.port,
            secure: config.port === 465,
            auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
        });
    }
    return { transporter, from: config.from };
}
async function sendEmail(to, subject, content) {
    const { transporter: t, from: smtpFrom } = getTransporter();
    if (!t) {
        return { ok: false, error: 'SMTP tidak dikonfigurasi (SMTP_HOST atau MAIL_USER/MAIL_PASS kosong).' };
    }
    let text;
    let html;
    if (typeof content === 'string') {
        text = content;
    }
    else {
        text = content.text;
        if (content.template) {
            try {
                html = (0, emailTemplate_1.renderEmailTemplate)(content.template, content.context || {});
            }
            catch (error) {
                return { ok: false, error: error?.message || String(error) };
            }
        }
    }
    const attachments = [];
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
    }
    catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
}
