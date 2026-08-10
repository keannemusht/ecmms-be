-- AlterTable
ALTER TABLE "InAppNotification" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "whatsappMessage" TEXT,
ADD COLUMN     "whatsappPhone" TEXT;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
