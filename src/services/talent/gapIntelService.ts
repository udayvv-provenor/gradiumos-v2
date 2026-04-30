/**
 * Gap Intelligence — for the active career track, per-cluster gaps expanded to
 * sub-topic mastery with "in curriculum" overlay driven by the learner's
 * institution's coverage seed.
 */
import type { ClusterCode } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { bandFor, confidenceBand, gap } from '../competency/formulas.js';
import {
  ALL_CLUSTERS, institutionKey, loadSubtopics, parseTargets, parseWeights,
  round1, round3, subtopicMastery,
} from './helpers.js';
import { getLearnerWithScope, requireTrackEnrollment } from './learnerContext.js';

export async function getGapIntel(userId: string, careerTrackId: string) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, careerTrackId);
  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');

  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const byCode = new Map<ClusterCode, { scoreWeighted: number; confidence: number }>();
  for (const s of scores) byCode.set(s.clusterCode, { scoreWeighted: s.scoreWeighted, confidence: s.confidence });

  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const targets = parseTargets(careerTrack.clusterTargets);
  const weights = parseWeights(careerTrack.clusterWeights);

  const instKey = institutionKey(learner.institution.name);
  const subs = loadSubtopics();

  const rows = clusters.map((c) => {
    const s = byCode.get(c.code);
    const score = s?.scoreWeighted ?? 0;
    const threshold = targets[c.code] ?? 60;
    const weight = weights[c.code] ?? 0;
    const g = Math.max(0, gap(score, threshold));
    const subtopics = subs.filter((st) => st.clusterCode === c.code).map((st) => {
      const mastery = subtopicMastery(learner.id, st.code, score);
      return {
        code: st.code,
        name: st.name,
        mastery: round3(mastery),
        required: st.required,
        inCurriculum: st.inCurriculum[instKey] === true,
        curriculumSource: st.curriculumSource ?? null,
      };
    }).sort((a, b) => a.mastery - b.mastery); // weakest first
    return {
      clusterCode: c.code,
      clusterName: c.name,
      shortName: c.shortName,
      score: round1(score),
      threshold,
      gap: round1(g),
      weight: round3(weight),
      severity: round3(g * weight),
      band: bandFor(score, threshold),
      confidence: round3(s?.confidence ?? 0),
      confidenceBand: confidenceBand(s?.confidence ?? null),
      subtopics,
    };
  }).sort((a, b) => b.severity - a.severity);

  return { careerTrackId, clusters: rows };
}

export async function getCurriculumMap(userId: string, institutionId?: string, careerTrackId?: string) {
  const { learner } = await getLearnerWithScope(userId);
  const instId = institutionId ?? learner.institutionId;
  const institution = await prisma.institution.findUnique({ where: { id: instId } });
  if (!institution) throw new AppError('NOT_FOUND', 'Institution not found');
  const instKey = institutionKey(institution.name);
  const subs = loadSubtopics();

  const perCluster: Record<ClusterCode, { clusterCode: ClusterCode; covered: number; required: number; subtopics: { code: string; name: string; required: boolean; inCurriculum: boolean; curriculumSource: string | null }[] }> = {} as Record<ClusterCode, { clusterCode: ClusterCode; covered: number; required: number; subtopics: { code: string; name: string; required: boolean; inCurriculum: boolean; curriculumSource: string | null }[] }>;
  for (const c of ALL_CLUSTERS) {
    perCluster[c] = { clusterCode: c, covered: 0, required: 0, subtopics: [] };
  }
  for (const st of subs) {
    const bucket = perCluster[st.clusterCode];
    const inC = st.inCurriculum[instKey] === true;
    bucket.subtopics.push({
      code: st.code,
      name: st.name,
      required: st.required,
      inCurriculum: inC,
      curriculumSource: st.curriculumSource ?? null,
    });
    if (st.required) {
      bucket.required++;
      if (inC) bucket.covered++;
    }
  }
  const clusterRows = ALL_CLUSTERS.map((c) => {
    const b = perCluster[c];
    return {
      ...b,
      clusterName: b.clusterCode as string, // filled below from cluster name map
      coveragePct: b.required === 0 ? 0 : round3(b.covered / b.required),
    };
  });
  // Enrich cluster names
  const clusterDefs = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const nameMap = new Map(clusterDefs.map((c) => [c.code, c.name]));
  for (const row of clusterRows) row.clusterName = (nameMap.get(row.clusterCode) ?? row.clusterCode) as string;

  return {
    institutionId: institution.id,
    institutionName: institution.name,
    careerTrackId: careerTrackId ?? null,
    clusters: clusterRows,
  };
}
