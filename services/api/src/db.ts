import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var translatorPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.translatorPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis.translatorPrisma = prisma;
