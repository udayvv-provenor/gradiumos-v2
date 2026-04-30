/**
 * Institution ranking — fill efficiency formula from the workforce plan.
 *
 *   bulkAdvantage  = rolesCoverable / max(1, roles.length)
 *   qualityScore   = mean(avgMatchPerRole)        (0..1)
 *   depthScore     = min(1, qualifying / sum(seatsPlanned))
 *   fillEfficiency = 100 * (0.5 * bulkAdvantage + 0.3 * qualityScore + 0.2 * depthScore)
 */
import { ALL_CLUSTERS } from './helpers.js';

export interface FillEfficiencyInput {
  roles: { id: string; seatsPlanned: number }[];
  qualifying: number;               // size of qualifying pool
  avgMatchPerRole: number[];        // length == roles.length, each 0..1
  rolesCoverable: number;
}

export function fillEfficiency(input: FillEfficiencyInput): number {
  const { roles, qualifying, avgMatchPerRole, rolesCoverable } = input;
  const rolesCount = Math.max(1, roles.length);
  const totalSeats = Math.max(1, roles.reduce((a, r) => a + Math.max(0, r.seatsPlanned), 0));
  const bulkAdvantage = rolesCoverable / rolesCount;
  const qualityScore = avgMatchPerRole.length === 0
    ? 0
    : avgMatchPerRole.reduce((a, b) => a + b, 0) / avgMatchPerRole.length;
  const depthScore = Math.min(1, qualifying / totalSeats);
  return Math.round((100 * (0.5 * bulkAdvantage + 0.3 * qualityScore + 0.2 * depthScore)) * 10) / 10;
}

/**
 * rolesCoverable = number of roles where qualifying pool ≥ seatsPlanned AND avgMatch ≥ 0.60.
 */
export function countRolesCoverable(
  roles: { seatsPlanned: number }[],
  qualifying: number,
  avgMatchPerRole: number[],
): number {
  let n = 0;
  for (let i = 0; i < roles.length; i++) {
    if (qualifying >= roles[i].seatsPlanned && (avgMatchPerRole[i] ?? 0) >= 0.60) n++;
  }
  return n;
}

export { ALL_CLUSTERS };
