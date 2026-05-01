import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Option B — connection pool via DATABASE_URL ?connection_limit param.
// Railway PostgreSQL has a max_connections of ~97 (Hobby plan).
// We cap at 10 per dyno. If DATABASE_URL already contains connection_limit,
// the ?connection_limit query param set in the URL takes precedence over
// this comment — Prisma reads it from the URL directly.
// To override: add ?connection_limit=10&pool_timeout=20 to DATABASE_URL in Railway.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  datasources: {
    db: {
      // Append pool settings only when not already in the URL (safe append)
      url: (() => {
        const base = process.env['DATABASE_URL'] ?? '';
        if (base.includes('connection_limit')) return base;
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}connection_limit=10&pool_timeout=20`;
      })(),
    },
  },
});

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}
