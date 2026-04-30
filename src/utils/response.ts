import type { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ data, error: null });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown): Response {
  return res.status(status).json({ data: null, error: { code, message, details } });
}
