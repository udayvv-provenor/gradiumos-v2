import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as signalConfidenceService from '../services/signal/signalConfidenceService.js';

export async function getSignalConfidence(req: Request, res: Response) {
  ok(res, await signalConfidenceService.getSignalConfidence(req.auth!.inst));
}
