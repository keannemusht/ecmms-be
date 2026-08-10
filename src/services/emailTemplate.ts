import fs from 'fs';
import path from 'path';
import handlebars from 'handlebars';

const templateCache: Record<string, handlebars.TemplateDelegate> = {};

function resolveTemplateDir(): string {
  const candidates = [
    path.join(__dirname, 'emailTemplates'),
    path.join(process.cwd(), 'src/services/emailTemplates'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

export function renderEmailTemplate(templateName: string, context: Record<string, unknown>): string {
  const dir = resolveTemplateDir();
  const file = path.join(dir, `${templateName}.hbs`);

  if (!templateCache[templateName]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Email template tidak ditemukan: ${templateName}.hbs`);
    }
    const source = fs.readFileSync(file, 'utf8');
    templateCache[templateName] = handlebars.compile(source);
  }

  return templateCache[templateName](context);
}
