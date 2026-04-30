import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import * as signup from '../services/admin/signupService.js';

/**
 * v3.1 — first-failed-field error message.
 *
 * Previously the user got a generic "Invalid signup payload" with no hint of
 * what was wrong (e.g. password too short → opaque). Now we surface the first
 * field-level message ("Password must be at least 8 characters") so the form
 * can actually show what to fix.
 */
function firstFieldError(zodFlat: { fieldErrors: Record<string, string[] | undefined> }): string {
  const FRIENDLY: Record<string, string> = {
    institutionName: 'Institution name',
    employerName:    'Company name',
    inviteCode:      'Invite code',
    email:           'Email',
    password:        'Password',
    name:            'Your name',
  };
  for (const [key, errs] of Object.entries(zodFlat.fieldErrors)) {
    if (errs && errs.length > 0) {
      const label = FRIENDLY[key] ?? key;
      return `${label}: ${errs[0]}`;
    }
  }
  return 'Invalid signup payload';
}

// v3.1 — `type` (institution) is no longer asked at signup. We default to
// 'higher-ed' server-side; the AISHE/NIRF derivation later refines if needed.
// The user only types things they actually know about themselves.
const InstitutionBody = z.object({
  institutionName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(120),
});

// v3.1 — `archetype` is no longer asked of an employer. It's derived from the
// mode of their roles' archetypes (each role's archetype itself extracted from
// the JD by Groq). Until the first JD lands, archetype is null and surfaced
// as "Pending classification" in the UI.
const EmployerBody = z.object({
  employerName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(120),
});

const LearnerBody = z.object({
  inviteCode: z.string().min(8).max(8),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(120),
});

export async function postInstitutionSignup(req: Request, res: Response) {
  const parsed = InstitutionBody.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new AppError('VALIDATION', firstFieldError(flat), flat);
  }
  const result = await signup.signupInstitution(parsed.data);
  ok(res, result);
}

export async function postEmployerSignup(req: Request, res: Response) {
  const parsed = EmployerBody.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new AppError('VALIDATION', firstFieldError(flat), flat);
  }
  const result = await signup.signupEmployer(parsed.data);
  ok(res, result);
}

export async function postLearnerSignup(req: Request, res: Response) {
  const parsed = LearnerBody.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new AppError('VALIDATION', firstFieldError(flat), flat);
  }
  // BC 13 — pass IP so consentService can stamp it on the default consent rows
  const ipAddress = (req.headers['x-forwarded-for'] as string | undefined) ?? req.ip ?? '';
  const result = await signup.signupLearner({ ...parsed.data, ipAddress });
  ok(res, result);
}
