"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const emailTemplate_1 = require("./emailTemplate");
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || (SMTP_HOST === 'smtp.gmail.com' ? '465' : '587'), 10);
const SMTP_USER = process.env.SMTP_USER || process.env.MAIL_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.MAIL_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || (SMTP_USER ? `ECMMS <${SMTP_USER}>` : 'no-reply@ecmms.local');
let transporter = null;
function getTransporter() {
    // Prefer explicit SMTP config; fall back to Gmail app password (MAIL_USER/MAIL_PASS).
    const host = SMTP_HOST || (SMTP_USER && SMTP_PASS ? 'smtp.gmail.com' : '');
    if (!host) {
        return null;
    }
    if (!transporter) {
        transporter = nodemailer_1.default.createTransport({
            host,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
        });
    }
    return transporter;
}
async function sendEmail(to, subject, content) {
    const t = getTransporter();
    if (!t) {
        return { ok: false, error: 'SMTP tidak dikonfigurasi (SMTP_HOST kosong).' };
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
    try {
        await t.sendMail({ from: SMTP_FROM, to, subject, html, text });
        return { ok: true };
    }
    catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
}
