/**
 * Integration test for the golden-path end-to-end feature.
 *
 * Requires a live Postgres — run `npm run db:migrate && npm run db:seed` first, then `npm test`.
 * The test:
 *   1. logs in as the seeded Dean
 *   2. calls GET /api/overview/kpis — captures baseline activeAugmentation
 *   3. picks a cluster without an existing programme on cohort 2024-BE-A
 *   4. calls POST /api/campus/augmentation-programmes → expects 201
 *   5. calls GET /api/campus/augmentation-programmes → new programme appears
 *   6. calls GET /api/overview/kpis → activeAugmentation increased by cohort size
 *   7. calls POST again with same body → expects 409 CONFLICT
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/db.js';

const app = buildApp();

describe('Golden path — Assign Augmentation Programme', () => {
  let accessToken = '';
  let cohortId = '';
  let targetCluster = '';

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'krishnamurthy@srm.edu', password: 'DemoPass123!' });
    expect(login.status).toBe(200);
    accessToken = login.body.data.accessToken;

    const cohort = await prisma.cohort.findFirst({ where: { name: '2024-BE-A' } });
    if (!cohort) throw new Error('Seed data missing — run npm run db:seed');
    cohortId = cohort.id;

    const allClusters = ['C1','C2','C3','C4','C5','C6','C7','C8'] as const;
    const taken = await prisma.augmentationProgramme.findMany({ where: { cohortId }, select: { clusterCode: true } });
    const takenSet = new Set(taken.map((t) => t.clusterCode));
    const candidate = allClusters.find((c) => !takenSet.has(c));
    if (!candidate) throw new Error('All clusters already have programmes in this cohort');
    targetCluster = candidate;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the programme, updates KPIs, and rejects duplicates', async () => {
    const before = await request(app).get('/api/overview/kpis').set('authorization', `Bearer ${accessToken}`);
    expect(before.status).toBe(200);
    const activeBefore = before.body.data.activeAugmentation;

    const create = await request(app)
      .post('/api/campus/augmentation-programmes')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ cohortId, clusterId: targetCluster, triggerType: 'mandatory' });
    expect(create.status).toBe(201);
    expect(create.body.data.programme.clusterId).toBe(targetCluster);
    expect(create.body.data.assignmentsCreated).toBeGreaterThan(0);

    const list = await request(app).get('/api/campus/augmentation-programmes').set('authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((p: { clusterId: string; cohortId: string }) =>
      p.clusterId === targetCluster && p.cohortId === cohortId)).toBe(true);

    const after = await request(app).get('/api/overview/kpis').set('authorization', `Bearer ${accessToken}`);
    expect(after.body.data.activeAugmentation).toBe(activeBefore + create.body.data.assignmentsCreated);

    const dup = await request(app)
      .post('/api/campus/augmentation-programmes')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ cohortId, clusterId: targetCluster, triggerType: 'mandatory' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });
});
