import prisma from '../prisma';

export async function logAudit(
  userId: string | null | undefined,
  action: string,
  entity: string,
  details?: string,
  ipAddress?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity,
        details: details || null,
        ipAddress: ipAddress || null,
      },
    });
  } catch (error) {
    console.error('Failed to log audit activity:', error);
  }
}
