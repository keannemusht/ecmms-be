-- AlterEnum
-- Map existing 'WHATSAPP' values to 'EMAIL' so the enum cast succeeds even when
-- seed/historical rows still reference the value being removed.
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('EMAIL', 'IN_APP');
ALTER TABLE "NotificationRule" ALTER COLUMN "channels" TYPE "NotificationChannel_new"[] USING (
  array_replace("channels"::text[], 'WHATSAPP', 'EMAIL')::"NotificationChannel_new"[]
);
ALTER TABLE "NotificationLog" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING (
  CASE WHEN "channel"::text = 'WHATSAPP' THEN 'EMAIL'::"NotificationChannel_new" ELSE "channel"::text::"NotificationChannel_new" END
);
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;
