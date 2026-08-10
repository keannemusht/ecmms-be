-- AlterTable
ALTER TABLE "NotificationRule" DROP COLUMN "channel",
DROP COLUMN "targetRole",
ADD COLUMN     "channels" "NotificationChannel"[],
ADD COLUMN     "targetRoles" "Role"[];

-- SeedDefaultRules
INSERT INTO "NotificationRule" ("id", "name", "daysBefore", "channels", "targetRoles", "template", "isActive", "createdAt", "updatedAt") VALUES
('11111111-1111-1111-1111-111111111111', 'Reminder H-30', 30, '{EMAIL,WHATSAPP}', '{USER,MANAGEMENT}', 'Kontrak {{employeeName}} ({{contractNumber}}) akan berakhir dalam 30 hari pada {{endDate}}. Mohon persiapkan perpanjangan kontrak.', true, now(), now()),
('22222222-2222-2222-2222-222222222222', 'Reminder H-7', 7, '{EMAIL,WHATSAPP}', '{USER,MANAGEMENT}', 'Kontrak {{employeeName}} ({{contractNumber}}) akan berakhir dalam 7 hari pada {{endDate}}. Mohon segera proses tindak lanjut.', true, now(), now()),
('33333333-3333-3333-3333-333333333333', 'Reminder H-1', 1, '{EMAIL,WHATSAPP}', '{USER,MANAGEMENT}', 'Kontrak {{employeeName}} ({{contractNumber}}) berakhir besok pada {{endDate}}. Perlu tindakan segera.', true, now(), now());
