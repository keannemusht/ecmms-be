"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDirPath = exports.uploadContractDocument = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const isVercel = process.env.VERCEL === '1';
const uploadDir = isVercel ? path_1.default.join(os_1.default.tmpdir(), 'uploads') : path_1.default.join(__dirname, '../../uploads');
try {
    if (!fs_1.default.existsSync(uploadDir)) {
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
    }
}
catch (error) {
    console.warn('[Upload] Could not create upload directory, continuing without it:', error);
}
const allowedExtensions = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
const storage = multer_1.default.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
        cb(null, unique);
    },
});
exports.uploadContractDocument = (0, multer_1.default)({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        }
        else {
            cb(new Error('Tipe file tidak didukung. Gunakan PDF, DOC, DOCX, JPG, atau PNG.'));
        }
    },
});
exports.uploadDirPath = uploadDir;
