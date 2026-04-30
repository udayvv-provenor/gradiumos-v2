/**
 * Hiring analytics — funnel counts + velocity (weeks-to-decision).
 */
import { prisma } from '../../config/db.js';

export async function getFunnel(employerId: string) {
  const rows = await prisma.pipelineCandidate.findMany({ where: { employerId } });
  let invited = 0, assessed = 0, decisioned = 0;
  let offer = 0, hold = 0, reject = 0;
  for (const r of rows) {
    if (r.stage === 'invited') invited++;
    else if (r.stage === 'assessed') assessed++;
    else if (r.stage === 'decisioned') {
      decisioned++;
      if (r.decision === 'offer') offer++;
      else if (r.decision === 'hold') hold++;
      else if (r.decision === 'reject') reject++;
    }
  }
  const result = {
    invited,
    assessed,
    decisioned: { total: decisioned, offer, hold, reject },
    summary: {
      totalInPipeline: rows.length,
      signalPassRate: assessed + decisioned === 0 ? 0 : Math.round(((assessed + decisioned) / Math.max(1, rows.length)) * 1000) / 1000,
      decisionRate: decisioned === 0 ? 0 : Math.round((decisioned / Math.max(1, rows.length)) * 1000) / 1000,
      offerRate: decisioned === 0 ? 0 : Math.round((offer / Math.max(1, decisioned)) * 1000) / 1000,
    },
  };

  return result;
}

export async function getVelocity(employerId: string) {
  const rows = await prisma.pipelineCandidate.findMany({
    where: { employerId },
    include: { role: true },
  });
  const byRole = new Map<string, { roleId: string; roleTitle: string; deltas: number[] }>();
  for (const r of rows) {
    if (!r.decidedAt) continue;
    const weeks = (r.decidedAt.getTime() - r.invitedAt.getTime()) / (1000 * 60 * 60 * 24 * 7);
    const g = byRole.get(r.roleId) ?? { roleId: r.roleId, roleTitle: r.role.title, deltas: [] };
    g.deltas.push(weeks);
    byRole.set(r.roleId, g);
  }
  const perRole = Array.from(byRole.values()).map((g) => {
    const avg = g.deltas.reduce((a, b) => a + b, 0) / Math.max(1, g.deltas.length);
    return {
      roleId: g.roleId,
      roleTitle: g.roleTitle,
      decisionedCount: g.deltas.length,
      avgWeeksToDecision: Math.round(avg * 10) / 10,
      minWeeks: g.deltas.length === 0 ? 0 : Math.round(Math.min(...g.deltas) * 10) / 10,
      maxWeeks: g.deltas.length === 0 ? 0 : Math.round(Math.max(...g.deltas) * 10) / 10,
    };
  });
  const allDeltas = Array.from(byRole.values()).flatMap((g) => g.deltas);
  const overallAvg = allDeltas.length === 0 ? 0 : allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length;
  const summary = {
    totalDecisioned: allDeltas.length,
    avgWeeksToDecision: Math.round(overallAvg * 10) / 10,
  };
  return { perRole, summary };
}
