// Copies .hbs email templates and image assets from src into dist so that the
// compiled build (dist/) contains them at runtime (e.g. when deployed with
// `node dist/index.js`).
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'services', 'emailTemplates');
const distDir = path.join(__dirname, '..', 'dist', 'services', 'emailTemplates');

if (!fs.existsSync(srcDir)) {
  console.error('[copy-templates] Source template dir not found:', srcDir);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.hbs') || f.endsWith('.png'));
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
}

console.log(`[copy-templates] Copied ${files.length} email asset(s) to ${distDir}`);
