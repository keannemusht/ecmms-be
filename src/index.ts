import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import employeeRoutes from './routes/employees';
import contractRoutes from './routes/contracts';
import submissionRoutes from './routes/submissions';
import notificationRoutes from './routes/notifications';
import reportRoutes from './routes/reports';
import userRoutes from './routes/users';
import departmentRoutes from './routes/departments';
import positionRoutes from './routes/positions';
import auditLogRoutes from './routes/auditLogs';
import evaluationRoutes from './routes/evaluations';
import searchRoutes from './routes/search';
import { initCronJobs, runContractExpirationCheck } from './services/cronService';
import { getEmailTemplatesDir } from './services/emailTemplate';
import { uploadDirPath } from './utils/upload';

const app = express();
const PORT = process.env.PORT || 8000;
const isVercel = process.env.VERCEL === '1';

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded contract documents
app.use('/uploads', express.static(uploadDirPath));

// Serve bundled email assets (e.g. logo) so emails can hotlink reliably.
app.use('/email-assets', express.static(getEmailTemplatesDir()));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/evaluations', evaluationRoutes);
app.use('/api/search', searchRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', system: 'ECMMS PKWT Monitoring API', timestamp: new Date().toISOString() });
});

// Cron endpoint for Vercel Cron Jobs (see vercel.json). Runs the daily contract
// expiration / notification check. Protected so it can't be triggered manually.
app.get('/api/cron/contract-expiration', async (req, res) => {
  if (process.env.ENABLE_CRON === 'false') {
    return res.status(200).json({ ok: true, message: 'Cron is disabled via ENABLE_CRON=false.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron =
    req.get('x-vercel-cron') === '1' ||
    req.get('x-vercel-cron-schedule') !== undefined ||
    /vercel-cron/i.test(req.get('user-agent') || '');
  const hasValidSecret = !!cronSecret && req.get('authorization') === `Bearer ${cronSecret}`;
  if (!isVercelCron && !hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const summary = await runContractExpirationCheck();
    const ok = summary.errors.length === 0;
    return res.status(ok ? 200 : 500).json({ ok, summary });
  } catch (error: any) {
    console.error('[Cron] Failed to run contract expiration check via cron endpoint:', error);
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 ECMMS Backend API running on http://localhost:${PORT}`);
  console.log(`=======================================================`);

  // node-cron + startup check only run outside Vercel serverless (where
  // long-running processes are not guaranteed). On Vercel, scheduling is
  // handled by Vercel Cron Jobs -> /api/cron/contract-expiration.
  if (!isVercel) {
    initCronJobs();
  }
});

export default app;
