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
import { initCronJobs } from './services/cronService';
import { uploadDirPath } from './utils/upload';

const app = express();
const PORT = process.env.PORT || 8000;

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', system: 'ECMMS PKWT Monitoring API', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 ECMMS Backend API running on http://localhost:${PORT}`);
  console.log(`=======================================================`);

  // Start background monitoring cron
  initCronJobs();
});
