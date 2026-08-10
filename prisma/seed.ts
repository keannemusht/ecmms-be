import 'dotenv/config';
import prisma from '../src/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding ECMMS database...');

  // Clean existing data
  await prisma.auditLog.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.notificationRule.deleteMany();
  await prisma.submissionForm.deleteMany();
  await prisma.contractHistory.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();

  // Admin User
  const hashedPasswordAdmin = await bcrypt.hash('@Batara2026', 10);

  await prisma.user.create({
    data: {
      email: 'admin@bataramining.com',
      name: 'Super Admin',
      password: hashedPasswordAdmin,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Seeding ECMMS database completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
