/**
 * Peer intelligence — aggregate OTHER employers' roles across career tracks.
 * Drives the Demand Intelligence page and the Overview career-tracks peer column.
 */
import { prisma } from '../../config/db.js';
import { ALL_CLUSTERS, parseTargets, parseWeights, meanTargets, meanWeights, round1 } from './helpers.js';
import type { Archetype } from '@prisma/client';

export async function getPeerDemand(employerId: string, careerTrackId?: string) {
  const peers = await prisma.employerRole.findMany({
    where: {
      employerId: { not: employerId },
      status: 'active',
      ...(careerTrackId ? { careerTrackId } : {}),
    },
    include: { employer: true, careerTrack: true },
  });

  // Group by careerTrackId
  const byTrack = new Map<string, typeof peers>();
  for (const p of peers) {
    const list = byTrack.get(p.careerTrackId) ?? [];
    list.push(p);
    byTrack.set(p.careerTrackId, list);
  }

  const rows = Array.from(byTrack.entries()).map(([ctId, list]) => {
    const first = list[0];
    const weights = list.map((r) => parseWeights(r.clusterWeights));
    const targets = list.map((r) => parseTargets(r.clusterTargets));
    const avgWeights = meanWeights(weights);
    const avgTargets = meanTargets(targets);
    const byArchetype: Record<Archetype, number> = { Product: 0, Service: 0, MassRecruiter: 0 };
    const employerSet = new Set<string>();
    for (const r of list) {
      byArchetype[r.employer.archetype as Archetype] = (byArchetype[r.employer.archetype as Archetype] ?? 0) + 1;
      employerSet.add(r.employer.name);
    }
    const seatsTotal = list.reduce((a, r) => a + r.seatsPlanned, 0);
    return {
      careerTrackId: ctId,
      careerTrackName: first.careerTrack.name,
      peerEmployers: Array.from(employerSet),
      peerRolesOpen: list.length,
      peerSeats: seatsTotal,
      byArchetype,
      avgWeights: ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => {
        acc[c] = round1((avgWeights[c] ?? 0) * 100) / 100;
        return acc;
      }, {}),
      avgTargets: ALL_CLUSTERS.reduce<Record<string, number>>((acc, c) => {
        acc[c] = round1(avgTargets[c]?.target ?? 0);
        return acc;
      }, {}),
    };
  });

  rows.sort((a, b) => b.peerRolesOpen - a.peerRolesOpen);

  return {
    rows,
    summary: {
      totalPeerRoles: peers.length,
      totalPeerSeats: peers.reduce((a, r) => a + r.seatsPlanned, 0),
      peerEmployersCount: new Set(peers.map((p) => p.employerId)).size,
    },
  };
}
