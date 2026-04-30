/**
 * learnService — backs the Talent /learn portal.
 *
 * One subtopic = one full learning experience: Concept (visual primer),
 * Tutor (Socratic AI chat scoped to this subtopic), Practice (graded
 * assessment items), Apply (capstone — wired in Session 2), Progress
 * (mastery + attempts).
 *
 * Concept content is hand-authored JSON in `src/seed-data/concepts/`. If
 * a subtopic doesn't have authored content yet, we synthesise a stub so
 * the page still renders rather than 404'ing — flagged with `authored:false`
 * so the UI can show a "minimal content for now" hint.
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { loadSubtopics, loadAssessmentBank, ALL_CLUSTERS, type SubTopic, type AssessmentItem } from '../talent/helpers.js';
import { getLearnerIdOrThrow } from '../talent/learnerContext.js';

const CONCEPT_DIR = resolve(process.cwd(), 'src', 'seed-data', 'concepts');

export interface ConceptDiagram {
  type:    'mermaid' | 'svg' | 'image';
  caption: string;
  source:  string;
}

export interface SubtopicConcept {
  subtopicCode:         string;
  title:                string;
  subtitle:             string;
  estimatedReadMinutes: number;
  markdown:             string;
  diagrams:             ConceptDiagram[];
  tutorOpener:          string;
  authored:             boolean;     // false → stub fallback content
}

export interface SubtopicSummary {
  code:        string;
  name:        string;
  clusterCode: ClusterCode;
  required:    boolean;
  authored:    boolean;     // does this subtopic have hand-authored Concept content?
  practiceCount: number;    // # of assessment items currently mapped to this subtopic
  // v3.1 — career-track relevance + gating (real boundaries, not just metadata)
  tracks:      string[];    // canonical career tracks this subtopic serves (SWE, DATA, ...)
  relevant:    boolean;     // true if relevant to the learner's chosen track
  unlocked:    boolean;     // false → predecessor subtopic mastery < UNLOCK_THRESHOLD
  lockReason?: string;      // human-readable explanation when unlocked=false
  mastery:     number;      // 0..1 — surfaced at index level for the lock check + UI
}

/* v3.1 — career-track relevance map. Derived from cluster code + subtopic
 * keywords. Centralised so the Learn index, the Subtopic page, and any
 * downstream "relevance" surface all use the same rule. */
const CLUSTER_DEFAULT_TRACKS: Record<string, string[]> = {
  C1: ['SWE', 'DATA', 'MLAI', 'FINTECH', 'OPS'],         // Core Tech
  C2: ['SWE', 'DATA', 'MLAI', 'FINTECH'],                // Problem Solving
  C3: ['SWE', 'DATA', 'MLAI', 'FINTECH', 'OPS'],         // Execution
  C4: ['SWE', 'DATA', 'MLAI', 'FINTECH', 'PRODUCT'],     // Systems
  C5: ['SWE', 'DATA', 'OPS', 'CUSTSUCCESS', 'FINTECH', 'MLAI', 'PRODUCT', 'DESIGN'],  // Comm — universal
  C6: ['SWE', 'DATA', 'MLAI', 'FINTECH', 'PRODUCT'],     // Domain — refined by name below
  C7: ['SWE', 'DATA', 'OPS', 'CUSTSUCCESS', 'FINTECH', 'MLAI', 'PRODUCT', 'DESIGN'],  // Ownership — universal
  C8: ['SWE', 'DATA', 'OPS', 'CUSTSUCCESS', 'FINTECH', 'MLAI', 'PRODUCT', 'DESIGN'],  // Agility — universal
};

function tracksForSubtopic(s: SubTopic): string[] {
  const base = CLUSTER_DEFAULT_TRACKS[s.clusterCode] ?? [];
  // Domain (C6) refinement: keyword match on subtopic name
  if (s.clusterCode === 'C6') {
    const lower = s.name.toLowerCase();
    if (/ml|model|inference|feature|training/.test(lower)) return ['MLAI', 'DATA'];
    if (/payment|fintech|reconcil|ledger|kyc/.test(lower)) return ['FINTECH'];
    if (/ops|incident|sre|reliab/.test(lower))             return ['OPS', 'SWE'];
    if (/product|user|feature|roadmap/.test(lower))        return ['PRODUCT', 'SWE'];
  }
  return base;
}

const UNLOCK_THRESHOLD = 0.5;     // ≥50% mastery on predecessor unlocks the next subtopic

export interface SubtopicProgress {
  attemptsCount:   number;
  bestScore:       number;          // 0..100
  lastAttemptAt:   Date | null;
  mastery:         number;          // 0..1 — synthesised from cluster score + attempts
  tutorSessions:   number;
}

/* ─── Concept loader ──────────────────────────────────────────────────── */

function loadConceptFromFile(subtopicCode: string): SubtopicConcept | null {
  try {
    const path = join(CONCEPT_DIR, `${subtopicCode}.json`);
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as SubtopicConcept;
    return { ...data, authored: true };
  } catch {
    return null;
  }
}

/* v3.1.4 — AI-generated concept with cache.
 *
 * For subtopics that don't have a hand-authored JSON file (40+ of 47), we
 * AI-generate the primer on first request and cache in publicDataCache for
 * 30 days. The result has the same shape as hand-authored — UI doesn't
 * branch — but `authored: false` so the page can still flag it as
 * AI-generated if it wants.
 *
 * Falls back to mockConcept (deterministic) if Groq is unavailable. */
const CLUSTER_NAMES: Record<string, string> = {
  C1: 'Core Technical Foundations',
  C2: 'Applied Problem Solving',
  C3: 'Engineering Execution',
  C4: 'System & Product Thinking',
  C5: 'Communication & Collaboration',
  C6: 'Domain Specialisation',
  C7: 'Ownership & Judgment',
  C8: 'Learning Agility',
};

async function loadOrGenerateConcept(subtopic: SubTopic): Promise<SubtopicConcept> {
  // 1. Hand-authored JSON wins
  const fromFile = loadConceptFromFile(subtopic.code);
  if (fromFile) return fromFile;

  // 2. Cache check
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(`concept:${subtopic.code}:v1`).digest('hex').slice(0, 16);
  const cached = await prisma.publicDataCache.findFirst({
    where: { stakeholderKind: 'system', stakeholderId: 'concept-cache', slot: 'concept', contextHash: hash },
  });
  if (cached && cached.expiresAt > new Date()) {
    const stored = cached.payload as SubtopicConcept | null;
    if (stored && stored.markdown) return { ...stored, authored: false };
  }

  // 3. AI-generate (with mock fallback inside the prompt)
  const { generateConcept } = await import('../ai/prompts/generateConcept.js');
  const { concept } = await generateConcept({
    subtopicCode: subtopic.code,
    subtopicName: subtopic.name,
    clusterCode:  subtopic.clusterCode,
    clusterName:  CLUSTER_NAMES[subtopic.clusterCode] ?? subtopic.clusterCode,
  });

  const fullConcept: SubtopicConcept = {
    subtopicCode:         subtopic.code,
    title:                concept.title,
    subtitle:             concept.subtitle,
    estimatedReadMinutes: concept.estimatedReadMinutes,
    markdown:             concept.markdown,
    diagrams:             concept.diagrams,
    tutorOpener:          concept.tutorOpener,
    authored:             false,    // AI-generated, not hand-authored
  };

  // 4. Cache (30 days)
  try {
    await prisma.publicDataCache.upsert({
      where: { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'system', stakeholderId: 'concept-cache', slot: 'concept', contextHash: hash } },
      update: { payload: fullConcept as any, retrievedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), fromFixture: false },
      create: { stakeholderKind: 'system', stakeholderId: 'concept-cache', slot: 'concept', contextHash: hash, payload: fullConcept as any, fromFixture: false, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  } catch {
    // cache write failures are non-fatal
  }

  return fullConcept;
}

/* v3.1 — improved stub. Drops the developer-facing "Session 3 of the
 * learning portal build" tell. The page reads like a deliberate "teach this
 * yourself with the AI tutor" surface rather than a hole in the content.
 * Authored primers exist for the SWE-track foundations (C1.BIG-O, C2.DP,
 * C3.GIT-FLOW, C4.TRADEOFF, C5.TECH-WRITING, C6.ML-BASICS, C7.RELIABILITY)
 * — everything else lands here. */
function stubConcept(subtopic: SubTopic): SubtopicConcept {
  const clusterReadable: Record<string, string> = {
    C1: 'Core Technical Foundations',
    C2: 'Applied Problem Solving',
    C3: 'Engineering Execution',
    C4: 'System & Product Thinking',
    C5: 'Communication & Collaboration',
    C6: 'Domain Specialisation',
    C7: 'Ownership & Judgment',
    C8: 'Learning Agility',
  };
  const clusterName = clusterReadable[subtopic.clusterCode] ?? subtopic.clusterCode;
  return {
    subtopicCode:         subtopic.code,
    title:                subtopic.name,
    subtitle:             `${subtopic.clusterCode} — ${clusterName}`,
    estimatedReadMinutes: 8,
    markdown:
`## ${subtopic.name}

**${subtopic.name}** belongs to the **${clusterName}** cluster. This is one of the GradiumOS skill areas employers actively measure when hiring for ${subtopic.clusterCode === 'C5' || subtopic.clusterCode === 'C7' ? 'every' : 'most'} engineering roles.

This subtopic is best learned interactively. Open the **Lesson** tab and the AI tutor will walk you through it card-by-card — explanations, examples, quick checks, and reflective prompts shaped to where YOU are right now. The Lesson Stream paces itself based on your answers; if you get a check wrong, it loops back with a different angle before moving on.

When you're ready to test what you've absorbed, jump to **Practice** for graded items in this cluster. Descriptive answers come back with AI feedback (strengths · gaps · suggestions) anchored on the rubric for each item.

### What this subtopic builds toward

- Direct relevance to the cluster score the platform tracks (${subtopic.clusterCode}).
- One of the inputs to your **Overall Readiness** number on the Dashboard.
- Surfaces in your GradiumOS Signal once your cluster confidence is high enough.

### Suggested order

1. Read this primer (you're here).
2. Open **Lesson** and complete one card sequence.
3. Take 2-3 **Practice** items.
4. Check your **Progress** — see whether mastery shifted.

If anything in the lesson feels stuck, type "I'm not sure" or "explain again" — the tutor treats that as a signal to detour and re-frame.`,
    diagrams:    [],
    tutorOpener: `Welcome to ${subtopic.name}. Before we begin: tell me what you already know about this topic, in your own words. Even a one-line answer is enough — I'll calibrate the lesson around it.`,
    authored:    false,
  };
}

/* ─── Practice items mapper ────────────────────────────────────────────
 * Today the assessment bank tags items by clusterCode only (not subtopic).
 * We surface ALL items in the cluster as the practice set for any subtopic
 * in that cluster, with the per-item title shown so the learner sees what
 * they're picking. A future schema upgrade can add an explicit subtopicCode
 * field to bank items for tighter mapping. */
function practiceForSubtopic(subtopic: SubTopic): AssessmentItem[] {
  const items = loadAssessmentBank();
  return items.filter((it) => it.clusterCode === subtopic.clusterCode);
}

/* ─── Progress aggregation ─────────────────────────────────────────────
 * Pulls AssessmentAttemptV2 + TutorSession rows for the learner that
 * touch this subtopic. */
async function computeProgress(learnerId: string, subtopic: SubTopic): Promise<SubtopicProgress> {
  // Practice attempts: bank items in this cluster
  const items = practiceForSubtopic(subtopic);
  const itemIds = items.map((i) => i.id);
  const attempts = itemIds.length === 0 ? [] : await prisma.assessmentAttemptV2.findMany({
    where: { learnerId, assessmentRef: { in: itemIds } },
    select: { score: true, submittedAt: true },
  });
  const attemptsCount = attempts.length;
  const bestScore = attempts.reduce((m, a) => Math.max(m, a.score ?? 0), 0);
  const lastAttemptAt = attempts.length > 0
    ? attempts.reduce((d: Date, a) => (a.submittedAt > d ? a.submittedAt : d), attempts[0].submittedAt)
    : null;

  // Tutor sessions on this subtopic
  const tutorSessions = await prisma.tutorSession.count({
    where: { learnerId, subtopicCode: subtopic.code },
  });

  // Cluster score → mastery anchor
  const clusterScore = await prisma.competencyScore.findUnique({
    where: { learnerId_clusterCode: { learnerId, clusterCode: subtopic.clusterCode } },
    select: { scoreWeighted: true, confidence: true },
  });
  const base = (clusterScore?.scoreWeighted ?? 0) / 100;
  const conf = clusterScore?.confidence ?? 0;
  // Mastery = anchored to cluster score, modulated by attempts confidence
  const mastery = Math.min(1, base * (0.5 + 0.5 * conf) + Math.min(0.15, attemptsCount * 0.03));

  return {
    attemptsCount,
    bestScore,
    lastAttemptAt,
    mastery: Math.round(mastery * 100) / 100,
    tutorSessions,
  };
}

/* ─── Public API ───────────────────────────────────────────────────────── */

/** GET /api/talent/me/learn — index across all clusters.
 *  v3.1 — now returns track relevance + per-subtopic mastery + sequential
 *  unlock state. Gating rule: within a cluster, a subtopic is unlocked iff
 *  it's the FIRST in the cluster OR the previous subtopic's mastery is at
 *  least UNLOCK_THRESHOLD (0.5). The Lesson Stream and Practice surfaces
 *  enforce this server-side too (see assertSubtopicAccessible). */
export async function getLearnIndex(userId: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  const subtopics = loadSubtopics();
  const bank = loadAssessmentBank();
  const scores = await prisma.competencyScore.findMany({
    where: { learnerId },
    select: { clusterCode: true, scoreWeighted: true, confidence: true },
  });
  const scoreByCluster = new Map<string, { score: number; confidence: number }>();
  for (const s of scores) scoreByCluster.set(s.clusterCode, { score: s.scoreWeighted, confidence: s.confidence });

  // v3.1 — fetch learner's enrolled track (the canonical CareerTrack code via
  // the institutional Track binding). Used for relevance reordering.
  const learner = await prisma.learner.findUnique({
    where: { id: learnerId },
    include: { track: { include: { careerTrack: true } } },
  });
  const learnerTrackCode = learner?.track?.careerTrack?.code ?? null;

  // Pre-compute mastery per subtopic across all clusters (one DB pass for
  // attempts, then synthesise — same formula as computeProgress).
  const allSubs = subtopics;
  const allItemIds = bank.map((b) => b.id);
  const allAttempts = allItemIds.length === 0 ? [] : await prisma.assessmentAttemptV2.findMany({
    where: { learnerId, assessmentRef: { in: allItemIds } },
    select: { score: true, assessmentRef: true },
  });
  const itemToCluster = new Map<string, string>();
  for (const b of bank) itemToCluster.set(b.id, b.clusterCode);
  // Group attempts by cluster (we map subtopic→cluster's items today)
  const attemptsByCluster = new Map<string, number[]>();
  for (const a of allAttempts) {
    const cc = itemToCluster.get(a.assessmentRef);
    if (!cc) continue;
    const arr = attemptsByCluster.get(cc) ?? [];
    arr.push(a.score ?? 0);
    attemptsByCluster.set(cc, arr);
  }
  function masteryFor(s: SubTopic): number {
    const cs = scoreByCluster.get(s.clusterCode);
    const base = (cs?.score ?? 0) / 100;
    const conf = cs?.confidence ?? 0;
    const attempts = attemptsByCluster.get(s.clusterCode) ?? [];
    return Math.min(1, base * (0.5 + 0.5 * conf) + Math.min(0.15, attempts.length * 0.03));
  }

  // Group by cluster, then within each cluster apply sequential unlock.
  const byCluster = ALL_CLUSTERS.map((cc) => {
    const subsRaw = allSubs.filter((s) => s.clusterCode === cc);
    const subs: SubtopicSummary[] = subsRaw.map((s, idx) => {
      const tracks = tracksForSubtopic(s);
      const relevant = learnerTrackCode ? tracks.includes(learnerTrackCode) : true;
      const m = masteryFor(s);
      // Sequential unlock — first subtopic in cluster always open; rest gated
      // by predecessor mastery.
      const prev = idx > 0 ? subsRaw[idx - 1] : null;
      const prevMastery = prev ? masteryFor(prev) : 1;
      const unlocked = idx === 0 || prevMastery >= UNLOCK_THRESHOLD;
      return {
        code:          s.code,
        name:          s.name,
        clusterCode:   s.clusterCode,
        required:      s.required,
        authored:      loadConceptFromFile(s.code) !== null,
        practiceCount: bank.filter((b) => b.clusterCode === cc).length,
        tracks,
        relevant,
        unlocked,
        lockReason:    unlocked ? undefined : `Reach ${Math.round(UNLOCK_THRESHOLD * 100)}% mastery on "${prev?.name}" to unlock`,
        mastery:       Math.round(m * 100) / 100,
      };
    });
    const cs = scoreByCluster.get(cc) ?? { score: 0, confidence: 0 };
    return {
      clusterCode: cc,
      score:       cs.score,
      confidence:  cs.confidence,
      subtopics:   subs,
    };
  });

  // Recommended = lowest-scoring cluster's first authored AND unlocked AND
  // (track-relevant if track known) subtopic.
  const sortedClusters = [...byCluster].sort((a, b) => a.score - b.score);
  let recommended: SubtopicSummary | undefined;
  for (const cluster of sortedClusters) {
    recommended = cluster.subtopics.find((s) => s.unlocked && s.authored && s.relevant)
              ?? cluster.subtopics.find((s) => s.unlocked && s.relevant)
              ?? cluster.subtopics.find((s) => s.unlocked);
    if (recommended) break;
  }

  return {
    learnerTrack: learnerTrackCode,
    unlockThresholdPct: Math.round(UNLOCK_THRESHOLD * 100),
    clusters:    byCluster,
    recommended: recommended ? { cluster: recommended.clusterCode, subtopic: recommended.code, name: recommended.name } : null,
  };
}

/** v3.1 — Server-enforced access check for any per-subtopic surface
 *  (next-card lesson, practice attempt, tutor session). Caller throws on
 *  rejection; this keeps the boundary in ONE place so all surfaces honour it.
 *
 *  v3.1.6 — synthesised subtopics (well-formed `Cn.SLUG` not in catalog)
 *  are always accessible — they're AI-generated and don't go through the
 *  curriculum gating. Malformed codes still 404.
 */
export async function assertSubtopicAccessible(userId: string, subtopicCode: string): Promise<void> {
  const idx = await getLearnIndex(userId);
  for (const cluster of idx.clusters) {
    const sub = cluster.subtopics.find((s) => s.code === subtopicCode);
    if (sub) {
      if (!sub.unlocked) {
        throw new AppError('AUTH_FORBIDDEN', `Subtopic locked: ${sub.lockReason}`);
      }
      return;
    }
  }
  // Not in catalog. If it's a well-formed code, allow (synthesised subtopic).
  if (/^C[1-8]\.[A-Z0-9][A-Z0-9-]{0,40}$/.test(subtopicCode)) return;
  throw new AppError('NOT_FOUND', `Sub-topic ${subtopicCode} not found`);
}

/** GET /api/talent/me/learn/:subtopicCode — full subtopic page payload.
 *  v3.1 — gates access via assertSubtopicAccessible so a learner can't
 *  bypass the lock by typing the URL directly. */
export async function getSubtopic(userId: string, subtopicCode: string) {
  const learnerId = await getLearnerIdOrThrow(userId);
  await assertSubtopicAccessible(userId, subtopicCode);
  const { resolveOrSynthesizeSubtopic } = await import('../talent/subtopicResolver.js');
  const subtopic = resolveOrSynthesizeSubtopic(subtopicCode);

  // v3.1.4 — AI-generates concept on demand if not hand-authored, caches 30d.
  const concept = await loadOrGenerateConcept(subtopic);
  const practice = practiceForSubtopic(subtopic).map((it) => ({
    id:          it.id,
    title:       it.title,
    kind:        it.kind,
    clusterCode: it.clusterCode,
    timeLimitSec: it.timeLimitSec,
  }));
  const progress = await computeProgress(learnerId, subtopic);

  return {
    subtopic: {
      code:        subtopic.code,
      name:        subtopic.name,
      clusterCode: subtopic.clusterCode,
      required:    subtopic.required,
    },
    concept,
    practice,
    apply: null,             // wired in Session 2
    progress,
  };
}
