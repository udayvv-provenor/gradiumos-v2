import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import * as authService from '../services/auth/authService.js';

export async function postLogin(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password);
  ok(res, result);
}

export async function postRefresh(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken: string };
  const result = await authService.refresh(refreshToken);
  ok(res, result);
}

export async function postLogout(req: Request, res: Response) {
  const { refreshToken } = req.body as { refreshToken: string };
  await authService.logout(refreshToken);
  ok(res, { success: true });
}

export async function postHandoff(req: Request, res: Response) {
  const { accessToken } = req.body as { accessToken: string };
  const result = await authService.handoff(accessToken);
  ok(res, result);
}

export async function getMe(req: Request, res: Response) {
  const userId = req.auth!.sub;
  const me = await authService.getMe(userId);
  ok(res, me);
}
