/**
 * Thin wrapper that re-exports the cohort-tier insight from insightWorkforceService,
 * plus a top-learners helper. Keeps a stable import surface for controllers.
 */
import { getCohortsInsight, getCohortLearners } from './insightWorkforceService.js';

export async function rankCohortsFor(employerId: string, careerTrackId: string, institutionId: string) {
  return getCohortsInsight(employerId, careerTrackId, institutionId);
}

export async function topLearnersInCohort(
  employerId: string,
  cohortId: string,
  careerTrackId: string,
  limit = 20,
) {
  return getCohortLearners(employerId, cohortId, careerTrackId, limit);
}
