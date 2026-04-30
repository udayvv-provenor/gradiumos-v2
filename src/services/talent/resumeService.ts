/**
 * Resume generator — 3 variants (general, matched_company, jd_tailored).
 * GATED: throws 403 SIGNAL_BELOW_THRESHOLD when the learner's Signal score for the
 * track < 65. Synthesis is fully templated — picks top clusters + best attempts +
 * completed pathways + canonical pre-seeded blurbs → produces JSON sections.
 * For jd_tailored, a lightweight keyword re-ranker re-orders bullets against the JD.
 */
import type { ClusterCode, Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { ALL_CLUSTERS, loadResumeBlurbs, parseWeights, round3 } from './helpers.js';
import { getLearnerWithScope, requireTrackEnrollment } from './learnerContext.js';
import { computeSignalScore } from './signalTalentService.js';
import { renderResumeHtml, type ResumeLikeRecord } from './resumePdf.js';

const SIGNAL_MIN = 65;

interface SectionItem {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  body?: string;
}
interface Section {
  type: 'experience' | 'skills' | 'education' | 'certifications' | 'projects';
  items: SectionItem[];
}

function pickTopClusters(
  scores: { clusterCode: ClusterCode; scoreWeighted: number; confidence: number }[],
  weights: Record<ClusterCode, number>,
  limit = 4,
): ClusterCode[] {
  return [...scores]
    .filter((s) => s.confidence >= 0.4)
    .sort((a, b) => (b.scoreWeighted * (weights[b.clusterCode] ?? 0)) - (a.scoreWeighted * (weights[a.clusterCode] ?? 0)))
    .slice(0, limit)
    .map((s) => s.clusterCode);
}

function keywordRank(bullets: string[], jd: string): string[] {
  const tokens = new Set(jd.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return [...bullets]
    .map((b) => {
      const bTokens = b.toLowerCase().split(/[^a-z0-9]+/);
      const hits = bTokens.filter((t) => tokens.has(t)).length;
      return { b, hits };
    })
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.b);
}

export async function generateResume(
  userId: string,
  body:
    | { variant: 'general'; careerTrackId: string }
    | { variant: 'matched_company'; careerTrackId: string; matchedRoleId: string }
    | { variant: 'jd_tailored'; careerTrackId: string; jdText: string },
) {
  const { learner } = await getLearnerWithScope(userId);
  await requireTrackEnrollment(learner.id, body.careerTrackId);

  const careerTrack = await prisma.careerTrack.findUnique({ where: { id: body.careerTrackId } });
  if (!careerTrack) throw new AppError('NOT_FOUND', 'Career track not found');

  // Signal gate — score must be ≥ 65 for this career track.
  const { score, confidence } = await computeSignalScore(learner.id, body.careerTrackId);
  if (score < SIGNAL_MIN) {
    throw new AppError('SIGNAL_BELOW_THRESHOLD',
      `Signal score (${Math.round(score)}) is below the ${SIGNAL_MIN} threshold for resume generation`,
      { score: Math.round(score), threshold: SIGNAL_MIN },
    );
  }

  const scores = await prisma.competencyScore.findMany({ where: { learnerId: learner.id } });
  const weights = parseWeights(careerTrack.clusterWeights);
  const topClusters = pickTopClusters(scores, weights);

  const blurbs = loadResumeBlurbs();
  const trackBlurb = blurbs.perTrack[careerTrack.code] ?? {
    headlineTemplate: `${careerTrack.name} candidate`,
    summaryTemplate: `${careerTrack.name} learner backed by GradiumOS Signal.`,
  };

  // Resume sections.
  const clusters = await prisma.competencyCluster.findMany({ orderBy: { code: 'asc' } });
  const clusterNameMap = new Map(clusters.map((c) => [c.code, c.name]));

  // SKILLS — one item per top cluster.
  const skillsItems: SectionItem[] = topClusters.map((c) => {
    const s = scores.find((x) => x.clusterCode === c);
    return {
      title: clusterNameMap.get(c) ?? c,
      subtitle: `GradiumOS Signal ${Math.round(s?.scoreWeighted ?? 0)} · conf ${(s?.confidence ?? 0).toFixed(2)}`,
      bullets: (blurbs.perCluster[c] ?? []).slice(0, 2),
    };
  });

  // EXPERIENCE — best attempts per top cluster, plus completed pathways.
  const attempts = await prisma.assessmentAttemptV2.findMany({
    where: { learnerId: learner.id },
    orderBy: { submittedAt: 'desc' },
  });
  const completed = await prisma.augmentationAssignment.findMany({
    where: { learnerId: learner.id, status: 'complete' },
    include: { programme: true },
    orderBy: { completedAt: 'desc' },
  });

  const experienceItems: SectionItem[] = [];
  for (const c of topClusters) {
    const best = attempts
      .filter((a) => a.clusterCode === c && a.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (best) {
      let clusterBullets = blurbs.perCluster[c] ?? [];
      if (body.variant === 'jd_tailored') clusterBullets = keywordRank(clusterBullets, body.jdText);
      experienceItems.push({
        title: `${clusterNameMap.get(c) ?? c} — Applied Work`,
        subtitle: `Signal score ${Math.round(best.score ?? 0)} · ${best.kind.toUpperCase()}`,
        bullets: clusterBullets.slice(0, 3),
      });
    }
  }
  for (const p of completed.slice(0, 3)) {
    experienceItems.push({
      title: `Augmentation Pathway — ${p.programme.title}`,
      subtitle: `${clusterNameMap.get(p.programme.clusterCode) ?? p.programme.clusterCode} · Completed ${p.completedAt?.toISOString().slice(0, 10) ?? '—'}`,
      bullets: (blurbs.perCluster[p.programme.clusterCode] ?? []).slice(0, 2),
    });
  }

  // EDUCATION
  const educationItems: SectionItem[] = [{
    title: learner.institution.name,
    subtitle: 'Undergraduate programme',
    body: `Enrolled in the ${careerTrack.name} career track via GradiumOS.`,
  }];

  // CERTIFICATIONS — issued signals.
  const signals = await prisma.gradiumSignal.findMany({
    where: { learnerId: learner.id, state: 'issued' },
    orderBy: { issuedAt: 'desc' },
  });
  const certItems: SectionItem[] = signals.slice(0, 5).map((s) => ({
    title: `GradiumOS Signal — ${clusterNameMap.get(s.clusterCode) ?? s.clusterCode}`,
    subtitle: `Issued ${s.issuedAt?.toISOString().slice(0, 10) ?? '—'} · portable Ed25519 token`,
  }));

  let sections: Section[] = [
    { type: 'experience', items: experienceItems },
    { type: 'skills', items: skillsItems },
    { type: 'education', items: educationItems },
  ];
  if (certItems.length > 0) sections.push({ type: 'certifications', items: certItems });

  // For jd_tailored, re-rank experience items by aggregate hit count.
  if (body.variant === 'jd_tailored') {
    const jd = body.jdText.toLowerCase();
    const tokens = new Set(jd.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const countHits = (it: SectionItem): number => {
      const text = ((it.bullets ?? []).join(' ') + ' ' + (it.subtitle ?? '') + ' ' + (it.title ?? '')).toLowerCase();
      return text.split(/[^a-z0-9]+/).filter((t) => tokens.has(t)).length;
    };
    sections = sections.map((sec) => {
      if (sec.type !== 'experience' && sec.type !== 'skills') return sec;
      return { ...sec, items: [...sec.items].sort((a, b) => countHits(b) - countHits(a)) };
    });
  }

  const cohort = await prisma.cohort.findUnique({ where: { id: learner.cohortId } });
  const focusText = topClusters.slice(0, 2).map((c) => clusterNameMap.get(c) ?? c).join(' \u00b7 ') || careerTrack.name;
  const cohortText = cohort?.name ?? careerTrack.code;
  const substitute = (s: string) =>
    s
      .replace(/\{name\}/g, learner.name)
      .replace(/\{institution\}/g, learner.institution.name)
      .replace(/\{cohort\}/g, cohortText)
      .replace(/\{focus\}/g, focusText)
      .replace(/\{signal\}/g, Math.round(score).toString());
  const headline = substitute(trackBlurb.headlineTemplate);
  let summary = substitute(trackBlurb.summaryTemplate);

  if (body.variant === 'matched_company') {
    const role = await prisma.employerRole.findUnique({
      where: { id: body.matchedRoleId },
      include: { employer: true },
    });
    if (!role) throw new AppError('NOT_FOUND', 'Matched role not found');
    summary = `Targeted application: ${role.title} at ${role.employer.name}. ` + summary;
  }

  const created = await prisma.resume.create({
    data: {
      learnerId: learner.id,
      careerTrackId: body.careerTrackId,
      variant: body.variant,
      matchedRoleId: body.variant === 'matched_company' ? body.matchedRoleId : null,
      jdText: body.variant === 'jd_tailored' ? body.jdText : null,
      headline,
      summary,
      sections: sections as unknown as Prisma.InputJsonValue,
      signalScoreAtGen: Math.round(score),
      signalConfAtGen: round3(confidence),
    },
  });

  return {
    id: created.id,
    careerTrackId: created.careerTrackId,
    variant: created.variant,
    matchedRoleId: created.matchedRoleId,
    headline: created.headline,
    summary: created.summary,
    sections,
    signalScoreAtGen: created.signalScoreAtGen,
    signalConfAtGen: created.signalConfAtGen,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function listResumes(userId: string, careerTrackId?: string) {
  const { learner } = await getLearnerWithScope(userId);
  const rows = await prisma.resume.findMany({
    where: { learnerId: learner.id, ...(careerTrackId ? { careerTrackId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  const mapped = rows.map((r) => ({
    id: r.id,
    careerTrackId: r.careerTrackId,
    variant: r.variant,
    matchedRoleId: r.matchedRoleId,
    headline: r.headline,
    signalScoreAtGen: r.signalScoreAtGen,
    signalConfAtGen: r.signalConfAtGen,
    createdAt: r.createdAt.toISOString(),
  }));

  return mapped;
}

export async function getResume(userId: string, id: string) {
  const { learner } = await getLearnerWithScope(userId);
  const r = await prisma.resume.findUnique({ where: { id } });
  if (!r || r.learnerId !== learner.id) {
    throw new AppError('NOT_FOUND', 'Resume not found');
  }
  return {
    id: r.id,
    careerTrackId: r.careerTrackId,
    variant: r.variant,
    matchedRoleId: r.matchedRoleId,
    jdText: r.jdText,
    headline: r.headline,
    summary: r.summary,
    sections: r.sections,
    signalScoreAtGen: r.signalScoreAtGen,
    signalConfAtGen: r.signalConfAtGen,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getResumeHtml(userId: string, id: string): Promise<string> {
  const { learner } = await getLearnerWithScope(userId);
  const r = await prisma.resume.findUnique({ where: { id } });
  if (!r || r.learnerId !== learner.id) {
    throw new AppError('NOT_FOUND', 'Resume not found');
  }

  const record: ResumeLikeRecord = {
    id: r.id,
    headline: r.headline,
    summary: r.summary,
    sections: r.sections as unknown as ResumeLikeRecord['sections'],
    createdAt: r.createdAt.toISOString().slice(0, 10),
    learnerName: learner.name,
    variant: r.variant,
    signalScoreAtGen: r.signalScoreAtGen,
    signalConfAtGen: r.signalConfAtGen,
  };
  return renderResumeHtml(record);
}
