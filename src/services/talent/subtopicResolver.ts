/**
 * subtopicResolver — single source of truth for "give me a SubTopic for this code".
 *
 * v3.1.6 — fixes Uday's "still some subtopics are not found it says" feedback.
 * Previously every per-subtopic surface threw NOT_FOUND if the code wasn't in
 * the seeded catalog. With dynamic career tracks + AI-generated everything,
 * a learner can land on any well-formed subtopic code (`Cn.SOMETHING`) and
 * the platform should HANDLE IT, not error out.
 *
 * Strategy:
 *   1. Catalog hit → return it (preferred — has curriculum mapping).
 *   2. Well-formed code but no catalog entry → SYNTHESISE a SubTopic from
 *      the code (cluster from `Cn.` prefix, name humanised from suffix).
 *      Marked `curriculumSource: 'synthesised'` so the UI can render an
 *      "AI-generated topic" pill if it wants.
 *   3. Malformed code → throw NOT_FOUND (real error, not a typo).
 */
import { loadSubtopics, type SubTopic } from './helpers.js';
import { AppError } from '../../utils/AppError.js';
import type { ClusterCode } from '@prisma/client';

const CODE_RE = /^(C[1-8])\.([A-Z0-9][A-Z0-9-]{0,40})$/;

/** Humanise a subtopic suffix slug into a readable name.
 *  Examples: "BIG-O" → "Big O", "TECH-WRITING" → "Tech Writing",
 *           "GRAPH-ALG" → "Graph Algorithms" (special-cased a few). */
function humaniseSuffix(suffix: string): string {
  const SPECIALS: Record<string, string> = {
    'BIG-O':       'Big-O & Complexity',
    'GRAPH-ALG':   'Graph Algorithms',
    'DP':          'Dynamic Programming',
    'GIT-FLOW':    'Git Workflow',
    'TRADEOFF':    'Architecture Tradeoffs',
    'TECH-WRITING':'Technical Writing Clarity',
    'ML-BASICS':   'Machine Learning Foundations',
    'RELIABILITY': 'Reliability & Ownership',
    'API-DESIGN':  'API Design',
    'SQL':         'SQL Patterns',
    'TESTING':     'Testing Strategy',
    'OBSERVABILITY':'Observability & Telemetry',
    'CODE-REVIEW': 'Code Review Skills',
    'DEBUGGING':   'Debugging Methods',
    'CACHING':     'Caching Strategy',
    'CONCURRENCY':'Concurrency & Threading',
    'SECURITY':    'Security Basics',
  };
  if (SPECIALS[suffix]) return SPECIALS[suffix];
  // Default: lowercase, split on hyphen, title-case each word
  return suffix.split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Resolve a subtopic code → SubTopic. Synthesises if not in catalog but
 *  well-formed. Throws NOT_FOUND only on truly malformed codes. */
export function resolveOrSynthesizeSubtopic(subtopicCode: string): SubTopic {
  const all = loadSubtopics();
  const fromCatalog = all.find((s) => s.code === subtopicCode);
  if (fromCatalog) return fromCatalog;

  const m = CODE_RE.exec(subtopicCode);
  if (!m) {
    throw new AppError('NOT_FOUND', `Sub-topic code ${subtopicCode} is malformed (expected Cn.SLUG)`);
  }
  const [, clusterCode, suffix] = m;
  return {
    code:             subtopicCode,
    clusterCode:      clusterCode as ClusterCode,
    name:             humaniseSuffix(suffix),
    required:         false,
    inCurriculum:     {},
    curriculumSource: 'synthesised',
  };
}
