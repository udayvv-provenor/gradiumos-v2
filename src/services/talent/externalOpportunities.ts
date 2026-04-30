/**
 * externalOpportunities — pull live job postings via Serper (LinkedIn + Naukri),
 * AI-extract cluster targets per posting, compute matchScore vs learner.
 *
 * v3.1.3 — added per Uday's feedback: "We are pulling Serper data, you even
 * said search job posts from LinkedIn and Naukri — why has the AI not
 * populated [Opportunities] in our style by understanding public info with
 * our IP O/P?"
 *
 * Pipeline:
 *   1. Issue 2 Serper queries (LinkedIn + Naukri) for the learner's track
 *      and city. Cache per (track, city) for 24h.
 *   2. For each top-N organic result, AI infers an 8-cluster target shape
 *      (uses inferTrackClusters — same prompt that sizes a new career track,
 *      gives us deterministic 0..100 targets per cluster).
 *   3. Compute matchScore against learner's competencyScores using the LOCKED
 *      matchScore formula.
 *   4. Return as opportunities with source='serper-linkedin'|'serper-naukri'.
 */
import { prisma } from '../../config/db.js';
import { serperSearchBatch } from '../publicData/serperClient.js';
import { inferTrackClusters } from '../ai/prompts/inferTrackClusters.js';
import { matchScore } from '../competency/formulas.js';

const CLUSTER_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const;
const CACHE_KEY_PREFIX = 'external-opps';

export interface ExternalOpportunity {
  id:           string;          // synthesised from URL hash
  title:        string;
  company:      string;
  location:     string | null;
  url:          string;
  source:       'serper-linkedin' | 'serper-naukri';
  matchPct:     number;          // 0..100, computed against learner's clusters
  clusterTargets: Record<string, number>;
  postedDate?:  string | null;
}

export async function getExternalOpportunities(args: {
  learnerId: string;
  track: string;
  city?: string;
  forceRefresh?: boolean;
}): Promise<ExternalOpportunity[]> {
  const city = args.city ?? 'India';
  const cacheKey = `${args.track}|${city}`;
  const ctx = { track: args.track, city };

  // Check cache first
  if (!args.forceRefresh) {
    const { ctxHash } = await import('../publicData/marketIntelService.js').then(m => ({ ctxHash: (c: any) => {
      const norm = Object.keys(c).sort().map(k => `${k}=${c[k] ?? ''}`).join('|');
      return require('crypto').createHash('sha256').update(norm).digest('hex').slice(0, 16);
    }})).catch(() => ({ ctxHash: () => 'na' }));
    const hash = ctxHash(ctx);
    const cached = await prisma.publicDataCache.findFirst({
      where: { stakeholderKind: 'talent', stakeholderId: args.learnerId, slot: CACHE_KEY_PREFIX, contextHash: hash },
    });
    if (cached && cached.expiresAt > new Date()) {
      const stored = cached.payload as ExternalOpportunity[] | null;
      if (Array.isArray(stored)) {
        // Recompute matchPct against current learner scores (cheap)
        return await rescoreMatch(args.learnerId, stored);
      }
    }
  }

  // Pull live Serper data — 2 queries (LinkedIn + Naukri)
  const role = inferRoleNameFromTrack(args.track);
  const results = await serperSearchBatch([
    { qt: 'open-roles-linkedin', ctx: { role, city } },
    { qt: 'open-roles-naukri',   ctx: { role, city } },
  ]);

  const opportunities: ExternalOpportunity[] = [];
  for (const result of results) {
    const allResults = result.allResults ?? [];
    const source = result.queryType.includes('linkedin') ? 'serper-linkedin' as const : 'serper-naukri' as const;
    for (const item of allResults.slice(0, 8)) {  // top 8 per source = up to 16 candidates
      // Skip non-job results (e.g. company landing pages, generic articles)
      if (!item.title || item.title.length < 8) continue;
      const link = item.link ?? '';
      // v3.1.9 — must be an actual job-posting URL pattern, not a generic page
      const isJobLink =
        /linkedin\.com\/(jobs|in)\//i.test(link) ||
        /naukri\.com\/(job|jobs|company\/.*\?|jobapply|career)/i.test(link) ||
        /(indeed|glassdoor|monsterindia|shine|hirist|cutshort|wellfound)\.[a-z.]+/i.test(link);
      if (!isJobLink) continue;

      // v3.1.8 — input-hash dedup on the per-job inferTrackClusters call.
      // Job titles repeat heavily across postings ("Senior Software Engineer"
      // shows up 50+ times) — without this we paid Groq each time. Now we
      // hash (title + snippet) and reuse across learners + cities.
      const titleHashSrc = `inferTrack:${(item.title ?? '').slice(0,160)}|${(item.snippet ?? '').slice(0,400)}:v1`;
      const titleHash = require('crypto').createHash('sha256').update(titleHashSrc).digest('hex').slice(0, 16);
      let clusterTargets: Record<string, number>;
      const titleCached = await prisma.publicDataCache.findFirst({
        where: { stakeholderKind: 'system', stakeholderId: 'job-title-clusters', slot: 'inferred-track', contextHash: titleHash },
      });
      if (titleCached && titleCached.expiresAt > new Date() && titleCached.payload) {
        clusterTargets = (titleCached.payload as { clusterTargets: Record<string, number> }).clusterTargets;
      } else {
        try {
          const inferred = await inferTrackClusters({
            trackName: item.title,
            trackDescription: item.snippet?.slice(0, 400) ?? undefined,
          });
          clusterTargets = inferred.inferred.clusterTargets;
          if (!inferred.meta.model.startsWith('mock-')) {
            try {
              await prisma.publicDataCache.upsert({
                where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'system', stakeholderId: 'job-title-clusters', slot: 'inferred-track', contextHash: titleHash } },
                update: { payload: { clusterTargets } as unknown as object, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), fromFixture: false },
                create: { stakeholderKind: 'system', stakeholderId: 'job-title-clusters', slot: 'inferred-track', contextHash: titleHash, payload: { clusterTargets } as unknown as object, fromFixture: false, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
              });
            } catch { /* non-fatal */ }
          }
        } catch {
          clusterTargets = { C1: 65, C2: 60, C3: 65, C4: 60, C5: 55, C6: 55, C7: 60, C8: 55 };
        }
      }

      opportunities.push({
        id: 'ext-' + Buffer.from(item.link ?? item.title).toString('base64').slice(0, 16),
        title: item.title.slice(0, 160),
        company: extractCompany(item),
        location: extractLocation(item) ?? city,
        url: item.link ?? '',
        source,
        matchPct: 0,            // will be filled by rescoreMatch below
        clusterTargets,
        postedDate: item.date ?? null,
      });
    }
  }

  const scored = await rescoreMatch(args.learnerId, opportunities);

  // Persist cache (24h TTL)
  try {
    const norm = Object.keys(ctx).sort().map(k => `${k}=${(ctx as any)[k] ?? ''}`).join('|');
    const hash = require('crypto').createHash('sha256').update(norm).digest('hex').slice(0, 16);
    await prisma.publicDataCache.upsert({
      where: { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'talent', stakeholderId: args.learnerId, slot: CACHE_KEY_PREFIX, contextHash: hash } },
      update: { payload: opportunities as any, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), fromFixture: false },
      create: { stakeholderKind: 'talent', stakeholderId: args.learnerId, slot: CACHE_KEY_PREFIX, contextHash: hash, payload: opportunities as any, fromFixture: false, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
  } catch {
    // cache write failures are non-fatal
  }

  return scored;
}

async function rescoreMatch(learnerId: string, opps: ExternalOpportunity[]): Promise<ExternalOpportunity[]> {
  const scores = await prisma.competencyScore.findMany({ where: { learnerId } });
  const scoreByCluster = new Map(scores.map(s => [s.clusterCode, s.scoreWeighted]));
  return opps.map(o => {
    const entries = CLUSTER_CODES.map(c => ({
      scoreWeighted: scoreByCluster.get(c as any) ?? 0,
      target: o.clusterTargets[c] ?? 0,
      weight: 1,  // equal weight since we don't have per-job weights from AI
    })).filter(e => e.target > 0);
    const m = entries.length > 0 ? matchScore(entries) : 0;
    return { ...o, matchPct: Math.round(m * 100) };
  }).sort((a, b) => b.matchPct - a.matchPct);
}

function inferRoleNameFromTrack(track: string): string {
  // Track names are user-created (e.g. "Software Engineering", "Data Science").
  // Keep as-is for the search query — Serper handles natural language fine.
  return track;
}

function extractCompany(item: { title: string; snippet?: string; source?: string }): string {
  // LinkedIn snippets often contain "Company Name · Posted X days ago"
  const snip = item.snippet ?? '';
  const dotMatch = snip.match(/^([A-Z][A-Za-z0-9& .,'-]{2,40})\s*[·\|]/);
  if (dotMatch) return dotMatch[1].trim();
  // Title pattern: "Senior Backend Engineer at Razorpay"
  const atMatch = item.title.match(/\bat\s+([A-Z][A-Za-z0-9& .,'-]{2,40})/);
  if (atMatch) return atMatch[1].trim();
  return item.source ?? 'Unknown';
}

function extractLocation(item: { snippet?: string }): string | null {
  const snip = item.snippet ?? '';
  // Common pattern: "...· Bangalore" or "...· Mumbai, India"
  const locMatch = snip.match(/[·\|]\s*([A-Z][a-zA-Z]+(?:,\s*[A-Z][a-zA-Z]+)?)\s*(?:[·\|]|$)/);
  return locMatch ? locMatch[1] : null;
}
