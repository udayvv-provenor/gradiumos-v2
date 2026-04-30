import type { Request, Response, NextFunction } from 'express';
import { verifyAccess, type AccessClaims } from '../services/auth/jwt.js';
import { AppError } from '../utils/AppError.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('AUTH_INVALID', 'Missing bearer token'));
  }
  const token = header.slice(7).trim();
  req.auth = verifyAccess(token);
  next();
}

export function requireRole(...roles: AccessClaims['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new AppError('AUTH_INVALID', 'Not authenticated'));
    if (!roles.includes(req.auth.role)) {
      return next(new AppError('AUTH_FORBIDDEN', 'Insufficient role'));
    }
    next();
  };
}

/**
 * Ensures the request carries an institution scope. All Campus reads and writes are
 * institution-bound — this middleware exists so controllers can trust req.auth.inst.
 */
export function requireInstitutionScope(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.inst) return next(new AppError('AUTH_FORBIDDEN', 'Missing institution scope'));
  next();
}

/**
 * BC 29 — KYC gating middleware.
 *
 * Checks kycStatus for the employer or institution associated with the current
 * request. Returns 403 KYC_PENDING if not yet Verified.
 *
 * Apply to Phase B endpoints that require KYC (JD upload, role creation, etc.).
 * For Phase A this middleware is defined but not yet applied to any routes.
 *
 * Implementation note: kycStatus lives on the Employer / Institution DB row, not
 * in the JWT claims, so we must query the DB. We do a lightweight select of just
 * kycStatus to keep latency minimal.
 */
export function requireKycVerified(req: Request, res: Response, next: NextFunction): void {
  // Import prisma inside the function to avoid circular-import issues at module
  // load time (auth.ts → db.ts is fine, but we want to keep this file lean).
  import('../config/db.js').then(({ prisma }) => {
    const role   = req.auth?.role;
    const empId  = req.auth?.emp;
    const instId = req.auth?.inst;

    if (role === 'TA_LEAD' && empId) {
      prisma.employer.findUnique({ where: { id: empId }, select: { kycStatus: true } })
        .then((employer) => {
          if (!employer || employer.kycStatus !== 'Verified') {
            res.status(403).json({
              data: null,
              error: {
                code:    'KYC_PENDING',
                message: 'Verification in progress — typically within 3 working days.',
              },
            });
            return;
          }
          next();
        })
        .catch(next);
      return;
    }

    if ((role === 'DEAN' || role === 'PLACEMENT_OFFICER' || role === 'FACULTY_ADMIN') && instId) {
      prisma.institution.findUnique({ where: { id: instId }, select: { kycStatus: true } })
        .then((inst) => {
          if (!inst || inst.kycStatus !== 'Verified') {
            res.status(403).json({
              data: null,
              error: {
                code:    'KYC_PENDING',
                message: 'Verification in progress — typically within 3 working days.',
              },
            });
            return;
          }
          next();
        })
        .catch(next);
      return;
    }

    // Learners and roles not covered by KYC — pass through.
    next();
  }).catch(next);
}
