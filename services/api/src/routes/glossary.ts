import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { prisma } from '../db.js';
import { notFound } from '../errors.js';

const createTerm = z.object({
  sourceLanguage: z.enum(['zh', 'ru', 'en']),
  targetLanguage: z.enum(['zh', 'ru']),
  sourceTerm: z.string().trim().min(1).max(200),
  targetTerm: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).nullish(),
  enabled: z.boolean().default(true),
});

export async function registerGlossaryRoutes(app: FastifyInstance): Promise<void> {
  const registeredOnly = { preHandler: requireRole('USER') };
  app.get('/v1/glossary', registeredOnly, async (request) => {
    const query = z
      .object({
        sourceLanguage: z.enum(['zh', 'ru', 'en']).optional(),
        targetLanguage: z.enum(['zh', 'ru']).optional(),
      })
      .parse(request.query);
    const items = await prisma.glossaryTerm.findMany({
      where: { ownerId: request.auth.subjectId, ...query },
      orderBy: [{ enabled: 'desc' }, { sourceTerm: 'asc' }],
    });
    return { ok: true, data: { items } };
  });

  app.post('/v1/glossary', registeredOnly, async (request) => {
    const body = createTerm.parse(request.body);
    const term = await prisma.glossaryTerm.create({
      data: { ownerId: request.auth.subjectId, ...body, category: body.category || null },
    });
    return { ok: true, data: term };
  });

  app.patch('/v1/glossary/:id', registeredOnly, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = createTerm.partial().parse(request.body);
    const existing = await prisma.glossaryTerm.findFirst({
      where: { id, ownerId: request.auth.subjectId },
    });
    if (!existing) throw notFound('GLOSSARY_TERM_NOT_FOUND', '术语不存在');
    const term = await prisma.glossaryTerm.update({
      where: { id },
      data: { ...body, ...(body.category !== undefined ? { category: body.category || null } : {}) },
    });
    return { ok: true, data: term };
  });

  app.delete('/v1/glossary/:id', registeredOnly, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const deleted = await prisma.glossaryTerm.deleteMany({
      where: { id, ownerId: request.auth.subjectId },
    });
    if (!deleted.count) throw notFound('GLOSSARY_TERM_NOT_FOUND', '术语不存在');
    return { ok: true, data: {} };
  });
}
