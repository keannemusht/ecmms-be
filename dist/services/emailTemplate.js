"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEmailTemplate = renderEmailTemplate;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const handlebars_1 = __importDefault(require("handlebars"));
const templateCache = {};
function resolveTemplateDir() {
    const candidates = [
        path_1.default.join(__dirname, 'emailTemplates'),
        path_1.default.join(process.cwd(), 'src/services/emailTemplates'),
        path_1.default.join(process.cwd(), 'dist/services/emailTemplates'),
    ];
    return candidates.find((dir) => fs_1.default.existsSync(dir)) || candidates[0];
}
function renderEmailTemplate(templateName, context) {
    const dir = resolveTemplateDir();
    const file = path_1.default.join(dir, `${templateName}.hbs`);
    if (!templateCache[templateName]) {
        if (!fs_1.default.existsSync(file)) {
            throw new Error(`Email template tidak ditemukan: ${templateName}.hbs`);
        }
        const source = fs_1.default.readFileSync(file, 'utf8');
        templateCache[templateName] = handlebars_1.default.compile(source);
    }
    return templateCache[templateName](context);
}
