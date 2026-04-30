import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as settingsService from '../services/settings/settingsService.js';

export async function getSettings(req: Request, res: Response) {
  ok(res, await settingsService.getSettings(req.auth!.inst));
}
