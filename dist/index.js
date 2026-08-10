"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const employees_1 = __importDefault(require("./routes/employees"));
const contracts_1 = __importDefault(require("./routes/contracts"));
const submissions_1 = __importDefault(require("./routes/submissions"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const reports_1 = __importDefault(require("./routes/reports"));
const users_1 = __importDefault(require("./routes/users"));
const departments_1 = __importDefault(require("./routes/departments"));
const positions_1 = __importDefault(require("./routes/positions"));
const auditLogs_1 = __importDefault(require("./routes/auditLogs"));
const cronService_1 = require("./services/cronService");
const upload_1 = require("./utils/upload");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8000;
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Serve uploaded contract documents
app.use('/uploads', express_1.default.static(upload_1.uploadDirPath));
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/employees', employees_1.default);
app.use('/api/contracts', contracts_1.default);
app.use('/api/submissions', submissions_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/users', users_1.default);
app.use('/api/departments', departments_1.default);
app.use('/api/positions', positions_1.default);
app.use('/api/audit-logs', auditLogs_1.default);
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', system: 'ECMMS PKWT Monitoring API', timestamp: new Date().toISOString() });
});
app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 ECMMS Backend API running on http://localhost:${PORT}`);
    console.log(`=======================================================`);
    // Start background monitoring cron
    (0, cronService_1.initCronJobs)();
});
