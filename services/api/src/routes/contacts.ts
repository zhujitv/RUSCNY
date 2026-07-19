import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { prisma } from '../db.js';
import { conflict, notFound } from '../errors.js';

const contactBody = z.object({
  displayName: z.string().trim().min(1).max(100),
  company: z.string().trim().max(200).nullish(),
  country: z.string().trim().max(100).nullish(),
  phone: z.string().trim().max(50).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  notes: z.string().trim().max(2_000).nullish(),
});

export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  const registeredOnly = { preHandler: requireRole('USER') };

  app.get('/v1/contacts', registeredOnly, async (request) => {
    const query = z.object({ search: z.string().trim().max(100).optional() }).parse(request.query);
    const contacts = await prisma.contact.findMany({
      where: {
        ownerId: request.auth.subjectId,
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search, mode: 'insensitive' } },
                { company: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { ok: true, data: { items: contacts } };
  });

  app.post('/v1/contacts', registeredOnly, async (request) => {
    const body = contactBody.parse(request.body);
    const contact = await prisma.contact.create({
      data: {
        ownerId: request.auth.subjectId,
        ...normalizeContact(body),
      },
    });
    return { ok: true, data: contact };
  });

  app.get('/v1/contacts/:id', registeredOnly, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: request.auth.subjectId },
    });
    if (!contact) throw notFound('CONTACT_NOT_FOUND', '客户不存在');
    return { ok: true, data: contact };
  });

  app.patch('/v1/contacts/:id', registeredOnly, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = contactBody.parse(request.body);
    const exists = await prisma.contact.findFirst({
      where: { id, ownerId: request.auth.subjectId },
      select: { id: true },
    });
    if (!exists) throw notFound('CONTACT_NOT_FOUND', '客户不存在');
    const contact = await prisma.contact.update({
      where: { id },
      data: normalizeContact(body),
    });
    return { ok: true, data: contact };
  });

  app.delete('/v1/contacts/:id', registeredOnly, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const contact = await prisma.contact.findFirst({
      where: { id, ownerId: request.auth.subjectId },
      include: { _count: { select: { conversations: true } } },
    });
    if (!contact) throw notFound('CONTACT_NOT_FOUND', '客户不存在');
    if (contact._count.conversations > 0) {
      throw conflict('CONTACT_HAS_CONVERSATIONS', '该客户已有会议记录，不能直接删除');
    }
    await prisma.contact.delete({ where: { id } });
    return { ok: true, data: {} };
  });
}

function normalizeContact(body: z.infer<typeof contactBody>) {
  return {
    displayName: body.displayName,
    company: body.company || null,
    country: body.country || null,
    phone: body.phone || null,
    email: body.email || null,
    notes: body.notes || null,
  };
}
