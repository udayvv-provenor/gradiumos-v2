/**
 * DPDP Consent Service (BC 13–14)
 *
 * seedDefaultConsent — called on learner signup; creates 4 ConsentRecord rows
 * requireConsent     — guard for Groq calls; throws ConsentMissingError if revoked/absent
 */
import { prisma } from '../../config/db.js';

export const CONSENT_PURPOSES = [
  'assessment-grading',
  'tutor-AI',
  'opportunity-matching',
  'analytics',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ConsentMissingError extends Error {
  readonly purpose: string;
  constructor(purpose: string) {
    super(`Consent missing or revoked for purpose: ${purpose}`);
    this.name = 'ConsentMissingError';
    this.purpose = purpose;
  }
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/**
 * Throws ConsentMissingError if the user has no granted consent record for
 * the given purpose. The most-recent record for the purpose wins.
 */
export async function requireConsent(userId: string, purpose: string): Promise<void> {
  const record = await prisma.consentRecord.findFirst({
    where: { userId, purpose },
    orderBy: { grantedAt: 'desc' },
  });
  if (!record || !record.granted) throw new ConsentMissingError(purpose);
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/**
 * Seeds 4 default ConsentRecord rows for a newly-created learner.
 * All four purposes default to granted=true per DPDP Phase A spec.
 */
export async function seedDefaultConsent(userId: string, ipAddress: string): Promise<void> {
  await prisma.consentRecord.createMany({
    data: CONSENT_PURPOSES.map((purpose) => ({
      userId,
      purpose,
      granted: true,
      grantedAt: new Date(),
      ipAddress,
    })),
    skipDuplicates: true,
  });
}
