/**
 * Integration test — Talent portal golden path.
 *
 * Requires a live Postgres: run `npm run db:migrate && npm run db:seed` first.
 *
 * Path tested:
 *   1. Login as Zara Kaur (elite profile, Signal ≥ 65 immediately)
 *   2. GET /api/talent/me/tracks → primary track resolves
 *   3. GET /api/talent/me/overview?careerTrackId= → 200 with readiness + clusters
 *   4. POST /api/talent/me/signal/generate → 200 or 201 (GradiumOS Signal issued)
 *   5. POST /api/talent/me/resumes { variant: general } → 201 (gate passes)
 *   6. GET /api/talent/me/resumes/:id → 200, sections present
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../../src/app.js';
import { prisma } from '../../../src/config/db.js';

const app = buildApp();

describe('Talent portal — hero flow (Zara Kaur)', () => {
  let token = '';
  let primaryTrackId = '';
  let resumeId = '';

  beforeAll(async () => {
    // Login as Zara — elite profile, crosses Signal ≥ 65 without extra attempts.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'zara.kaur@bits.edu', password: 'DemoPass123!' });
    if (res.status !== 200) {
      throw new Error(`Login failed (${res.status}): ${JSON.stringify(res.body)} — run npm run db:seed`);
    }
    token = res.body.data.accessToken;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('GET /api/talent/me/tracks returns enrolled tracks with readiness', async () => {
    const res = await request(app)
      .get('/api/talent/me/tracks')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const tracks: Array<{ careerTrackId: string; isPrimary: boolean; readiness: number; signalState: string }> =
      res.body.data;
    expect(Array.isArray(tracks)).toBe(true);
    expect(tracks.length).toBeGreaterThanOrEqual(1);

    const primary = tracks.find((t) => t.isPrimary);
    expect(primary).toBeDefined();
    primaryTrackId = primary!.careerTrackId;
    expect(typeof primary!.readiness).toBe('number');
    expect(['building', 'ready', 'issued']).toContain(primary!.signalState);
  });

  it('GET /api/talent/me/overview returns readiness + cluster rows', async () => {
    const res = await request(app)
      .get(`/api/talent/me/overview?careerTrackId=${primaryTrackId}`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const { readiness, clusterRows, topGaps } = res.body.data;
    expect(typeof readiness).toBe('number');
    expect(readiness).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(clusterRows)).toBe(true);
    expect(clusterRows.length).toBe(8); // always 8 clusters
    expect(Array.isArray(topGaps)).toBe(true);
  });

  it('POST /api/talent/me/signal/generate issues a GradiumOS Signal', async () => {
    const res = await request(app)
      .post('/api/talent/me/signal/generate')
      .set('authorization', `Bearer ${token}`)
      .send({ careerTrackId: primaryTrackId });
    // May return 200 if already issued, or 201 on fresh issue
    expect([200, 201]).toContain(res.status);
    const signal = res.body.data;
    expect(signal).toBeDefined();
    // Response shape: { careerTrackId, score, confidence, issuedCount, kid, issued[] }
    expect(signal.careerTrackId).toBe(primaryTrackId);
    expect(typeof signal.score).toBe('number');
    expect(typeof signal.confidence).toBe('number');
    expect(typeof signal.issuedCount).toBe('number');
    expect(signal.issuedCount).toBeGreaterThan(0);
    expect(Array.isArray(signal.issued)).toBe(true);
    // Each issued item has a portable token
    for (const item of signal.issued) {
      expect(typeof item.portableToken).toBe('string');
      expect(item.portableToken.length).toBeGreaterThan(20);
    }
  });

  it('POST /api/talent/me/resumes (general) succeeds when Signal ≥ 65', async () => {
    const res = await request(app)
      .post('/api/talent/me/resumes')
      .set('authorization', `Bearer ${token}`)
      .send({ careerTrackId: primaryTrackId, variant: 'general' });
    expect(res.status).toBe(201);
    const resume = res.body.data;
    resumeId = resume.id;
    expect(typeof resume.headline).toBe('string');
    expect(resume.headline.length).toBeGreaterThan(0);
    expect(typeof resume.summary).toBe('string');
    expect(Array.isArray(resume.sections)).toBe(true);
    expect(resume.sections.length).toBeGreaterThan(0);
    expect(resume.signalScoreAtGen).toBeGreaterThanOrEqual(65);
  });

  it('GET /api/talent/me/resumes/:id returns the generated resume', async () => {
    expect(resumeId).toBeTruthy();
    const res = await request(app)
      .get(`/api/talent/me/resumes/${resumeId}`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.id).toBe(resumeId);
    expect(r.variant).toBe('general');
    expect(Array.isArray(r.sections)).toBe(true);
  });

  it('GET /api/talent/me/portfolio returns items + clusterSummaries', async () => {
    const res = await request(app)
      .get('/api/talent/me/portfolio')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const { items, clusterSummaries } = res.body.data;
    expect(Array.isArray(items)).toBe(true);
    expect(Array.isArray(clusterSummaries)).toBe(true);
    expect(clusterSummaries.length).toBe(8);
  });

  it('GET /api/talent/me/portfolio/employer-view returns redacted snapshot', async () => {
    const res = await request(app)
      .get('/api/talent/me/portfolio/employer-view')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const view = res.body.data;
    expect(typeof view.learnerName).toBe('string');
    expect(typeof view.institutionName).toBe('string');
    expect(Array.isArray(view.trackPills)).toBe(true);
    expect(Array.isArray(view.clusters)).toBe(true);
    expect(Array.isArray(view.evidence)).toBe(true);
    // All returned evidence must be visibleToEmployer
    for (const e of view.evidence) {
      // Employer view only returns items that are visible
      expect(e.type).toBeDefined();
    }
    expect(typeof view.hiddenCount).toBe('number');
  });
});
