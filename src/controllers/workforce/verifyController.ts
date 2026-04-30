import type { Request, Response } from 'express';
import { ok } from '../../utils/response.js';
import * as verify from '../../services/workforce/verificationService.js';
import type { VerifyBody } from '../../schemas/workforce/verify.js';

export async function verifySignal(req: Request, res: Response) {
  const body = req.body as VerifyBody;
  ok(res, verify.verifyToken(body.token));
}
