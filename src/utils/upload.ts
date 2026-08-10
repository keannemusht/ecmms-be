import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

const isVercel = process.env.VERCEL === '1';
const uploadDir = isVercel ? path.join(os.tmpdir(), 'uploads') : path.join(__dirname, '../../uploads');

try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (error) {
  console.warn('[Upload] Could not create upload directory, continuing without it:', error);
}

const allowedExtensions = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  },
});

export const uploadContractDocument = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak didukung. Gunakan PDF, DOC, DOCX, JPG, atau PNG.'));
    }
  },
});

export const uploadDirPath = uploadDir;
