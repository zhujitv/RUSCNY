import type { AuthContext } from '../lib/tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}
