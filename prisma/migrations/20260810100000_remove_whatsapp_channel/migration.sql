-- AlterEnum
BEGIN;
CREATE TYPE "NotificationChannel_new" AS ENUM ('EMAIL', 'IN_APP');
ALTER TABLE "NotificationRule" ALTER COLUMN "channels" TYPE "NotificationChannel_new"[] USING ("channels"::text::"NotificationChannel_new"[]);
ALTER TABLE "NotificationLog" ALTER COLUMN "channel" TYPE "NotificationChannel_new" USING ("channel"::text::"NotificationChannel_new");
ALTER TYPE "NotificationChannel" RENAME TO "NotificationChannel_old";
ALTER TYPE "NotificationChannel_new" RENAME TO "NotificationChannel";
DROP TYPE "public"."NotificationChannel_old";
COMMIT;
