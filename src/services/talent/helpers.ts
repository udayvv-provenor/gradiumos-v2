/**
 * Shared helpers for Talent services — deterministic jitter, sub-topic mastery,
 * cluster-constants, static JSON loaders.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ClusterCode } from '@prisma/client';

export const ALL_CLUSTERS: ClusterCode[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];

export function det01(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export function jitterDet(seed: string, spread = 0.15): number {
  // Returns a multiplier centred at 1, within [1-spread, 1+spread].
  const r = det01(seed);
  return 1 - spread + r * spread * 2;
}

export function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function round3(n: number): number { return Math.round(n * 1000) / 1000; }
export function round1(n: number): number { return Math.round(n * 10) / 10; }

export function parseWeights(raw: unknown): Record<ClusterCode, number> {
  const out = {} as Record<ClusterCode, number>;
  if (raw && typeof raw === 'object') {
    for (const c of ALL_CLUSTERS) {
      const n = Number((raw as Record<string, unknown>)[c]);
      out[c] = Number.isFinite(n) ? n : 0;
    }
  } else {
    for (const c of ALL_CLUSTERS) out[c] = 0;
  }
  return out;
}

export function parseTargets(raw: unknown): Record<ClusterCode, number> {
  const out = {} as Record<ClusterCode, number>;
  if (raw && typeof raw === 'object') {
    for (const c of ALL_CLUSTERS) {
      const v = (raw as Record<string, unknown>)[c];
      if (typeof v === 'number') out[c] = v;
      else if (v && typeof v === 'object') {
        const n = Number((v as Record<string, unknown>).target);
        out[c] = Number.isFinite(n) ? n : 0;
      } else out[c] = 0;
    }
  } else {
    for (const c of ALL_CLUSTERS) out[c] = 0;
  }
  return out;
}

// ─── Static JSON loaders ────────────────────────────────────────────────────
export interface SubTopic {
  code: string;
  clusterCode: ClusterCode;
  name: string;
  required: boolean;
  inCurriculum: Record<string, boolean>;
  curriculumSource?: string;
}

export interface AssessmentItemMCQ {
  id: string; clusterCode: ClusterCode; kind: 'mcq'; title: string; prompt: string;
  timeLimitSec: number; options: { id: string; text: string }[]; correctOptionId: string;
}
export interface AssessmentItemDescriptive {
  id: string; clusterCode: ClusterCode; kind: 'descriptive'; title: string; prompt: string;
  timeLimitSec: number; rubricBullets: string[];
}
export interface AssessmentItemCoding {
  id: string; clusterCode: ClusterCode; kind: 'coding'; title: string; prompt: string;
  timeLimitSec: number; starterCode: string; testCases: { input: string; expected: string }[];
}
export interface AssessmentItemSimulation {
  id: string; clusterCode: ClusterCode; kind: 'simulation'; title: string; prompt: string;
  timeLimitSec: number; roleContext: { you: string; stakeholders: { role: string; position: string }[] };
  expectedOutputHint: string;
}
export type AssessmentItem = AssessmentItemMCQ | AssessmentItemDescriptive | AssessmentItemCoding | AssessmentItemSimulation;

export interface ResumeBlurbs {
  perCluster: Record<ClusterCode, string[]>;
  perTrack: Record<string, { headlineTemplate: string; summaryTemplate: string }>;
}

const SEED_DIR = path.resolve(process.cwd(), 'src', 'seed-data');

let subtopicsCache: SubTopic[] | null = null;
export function loadSubtopics(): SubTopic[] {
  if (subtopicsCache) return subtopicsCache;
  const raw = fs.readFileSync(path.join(SEED_DIR, 'subtopics.json'), 'utf8');
  subtopicsCache = JSON.parse(raw) as SubTopic[];
  return subtopicsCache;
}

let assessmentsCache: AssessmentItem[] | null = null;
export function loadAssessmentBank(): AssessmentItem[] {
  if (assessmentsCache) return assessmentsCache;
  const raw = fs.readFileSync(path.join(SEED_DIR, 'assessmentBank.json'), 'utf8');
  assessmentsCache = JSON.parse(raw) as AssessmentItem[];
  return assessmentsCache;
}

let blurbsCache: ResumeBlurbs | null = null;
export function loadResumeBlurbs(): ResumeBlurbs {
  if (blurbsCache) return blurbsCache;
  const raw = fs.readFileSync(path.join(SEED_DIR, 'resumeBlurbs.json'), 'utf8');
  blurbsCache = JSON.parse(raw) as ResumeBlurbs;
  return blurbsCache;
}

/**
 * mastery = clamp01(scoreWeighted/100 * jitter(det01(learnerId + subtopicCode)))
 * — deterministic per (learner, sub-topic).
 */
export function subtopicMastery(learnerId: string, subtopicCode: string, clusterScore: number): number {
  const base = clusterScore / 100;
  return clamp01(base * jitterDet(learnerId + '|' + subtopicCode, 0.15));
}

export type InstitutionKey =
  | 'SRM' | 'VIT' | 'BITS'
  | 'MIT' | 'AMRITA' | 'THAPAR' | 'KIIT' | 'VITC'
  | 'OTHER';

/**
 * Map a free-form institution name to its curriculum-coverage key. v2 ships
 * with Manipal / Amrita / Thapar / KIIT / VIT-Chennai institutions; the
 * subtopics.json mapping has those columns populated alongside the legacy
 * SRM / VIT / BITS ones so curriculumCoverage > 0 on every persona.
 *
 * Order matters: VIT-Chennai must be checked before VIT (the substring rule).
 */
export function institutionKey(name: string): InstitutionKey {
  const n = name.toLowerCase();
  // VIT-Chennai's official name is "Vellore Institute of Technology Chennai"
  // — the substring "vit" doesn't appear, so match by "chennai" first. v2 has
  // no other Chennai institution, so this is unambiguous.
  if (n.includes('chennai')) return 'VITC';
  if (n.includes('manipal')) return 'MIT';
  if (n.includes('amrita')) return 'AMRITA';
  if (n.includes('thapar')) return 'THAPAR';
  if (n.includes('kiit')) return 'KIIT';
  if (n.includes('srm')) return 'SRM';
  if (n.includes('vit')) return 'VIT';
  if (n.includes('bits')) return 'BITS';
  return 'OTHER';
}

export function velocityFor(id: string, centre = 0.8, spread = 1.0): number {
  const v = centre - spread / 2 + det01(id) * spread;
  return Math.round(Math.max(0, v) * 10) / 10;
}
