/**
 * BC 92 — Verifier widget: minimal server-rendered HTML page.
 * BC 93 — Tampered/invalid/expired tokens render the "invalid or revoked" message.
 *
 * GET /verify/:signalId
 * Public — no auth, no portal frame.
 * Fetches the signal from the DB, verifies the Ed25519 token, renders HTML.
 *
 * Displays: valid, band, careerTrack, issuedAt, expiresAt, kid.
 * Never displays learner name, email, or numeric cluster scores.
 */

import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/db.js';
import { verifyToken, publicKeyKid } from '../services/signal/tokenSigner.js';
import { signalBandFor } from '../services/competency/formulas.js';

const router = Router();

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toISOString().slice(0, 10);
}

function renderWidget(opts: {
  valid: boolean;
  band?: string;
  careerTrack?: string;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  kid?: string;
  signalId: string;
}): string {
  const validColor  = '#16a34a'; // green-600
  const invalidColor = '#dc2626'; // red-600

  if (!opts.valid) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GradiumOS Signal Verifier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 40px 48px; max-width: 480px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.07); text-align: center; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: ${esc(String(invalidColor))}; margin: 0 0 8px; }
    p { font-size: 14px; color: #64748b; margin: 0 0 24px; line-height: 1.6; }
    .signal-id { font-size: 11px; font-family: monospace; color: #94a3b8; word-break: break-all; }
    .brand { margin-top: 32px; font-size: 12px; color: #94a3b8; }
    .brand strong { color: #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10005;</div>
    <h1>Signal Invalid or Revoked</h1>
    <p>This GradiumOS Signal is invalid, expired, or has been revoked. The credential cannot be verified.</p>
    <div class="signal-id">Signal ID: ${esc(opts.signalId)}</div>
    <div class="brand"><strong>GradiumOS</strong> &mdash; Verifiable Competence</div>
  </div>
</body>
</html>`;
  }

  const bandColors: Record<string, string> = {
    Advanced:   '#7c3aed',
    Proficient: '#16a34a',
    Developing: '#d97706',
    Emerging:   '#64748b',
  };
  const bandColor = bandColors[opts.band ?? ''] ?? '#1e293b';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GradiumOS Signal Verified</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 40px 48px; max-width: 520px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.07); }
    .header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .check { width: 48px; height: 48px; border-radius: 50%; background: #dcfce7; display: flex; align-items: center; justify-content: center; font-size: 22px; color: ${esc(validColor)}; flex-shrink: 0; }
    .title-block h1 { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 2px; }
    .title-block p  { font-size: 13px; color: #64748b; margin: 0; }
    .band-pill { display: inline-block; padding: 5px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; color: #fff; background: ${esc(bandColor)}; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 8px 0; font-size: 13px; color: #1e293b; vertical-align: top; }
    td:first-child { color: #64748b; width: 40%; padding-right: 12px; }
    tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
    .mono { font-family: monospace; font-size: 12px; word-break: break-all; }
    .signal-id { font-family: monospace; font-size: 11px; color: #94a3b8; margin-top: 20px; word-break: break-all; }
    .brand { margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: center; }
    .brand strong { color: #1e293b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="check">&#10003;</div>
      <div class="title-block">
        <h1>Signal Verified</h1>
        <p>This GradiumOS credential is authentic and has not been tampered with.</p>
      </div>
    </div>

    <div class="band-pill">${esc(opts.band ?? 'Unknown')}</div>

    <table>
      <tr>
        <td>Competency cluster</td>
        <td><strong>${esc(opts.careerTrack ?? '—')}</strong></td>
      </tr>
      <tr>
        <td>Issued</td>
        <td>${esc(formatDate(opts.issuedAt))}</td>
      </tr>
      <tr>
        <td>Expires</td>
        <td>${esc(formatDate(opts.expiresAt))}</td>
      </tr>
      <tr>
        <td>Key ID (kid)</td>
        <td class="mono">${esc(opts.kid ?? '—')}</td>
      </tr>
    </table>

    <div class="signal-id">Signal ID: ${esc(opts.signalId)}</div>
    <div class="brand"><strong>GradiumOS</strong> &mdash; Verifiable Competence &mdash; Ed25519</div>
  </div>
</body>
</html>`;
}

// BC 92 — Verifier widget HTML page (public, no auth)
router.get(
  '/verify/:signalId',
  asyncHandler(async (req: Request, res: Response) => {
    const { signalId } = req.params;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // No-store: verifier pages should always be fresh (revocation must be reflected immediately)
    res.setHeader('Cache-Control', 'no-store');

    const signal = await prisma.gradiumSignal.findUnique({
      where: { id: signalId },
    });

    if (!signal || !signal.portableToken) {
      res.status(404).send(renderWidget({ valid: false, signalId }));
      return;
    }

    // BC 93 — verifyToken returns null for tampered/expired tokens
    const payload = verifyToken(signal.portableToken);

    if (!payload) {
      res.status(200).send(renderWidget({ valid: false, signalId }));
      return;
    }

    const band = signalBandFor(payload.score);

    res.status(200).send(
      renderWidget({
        valid: true,
        band,
        careerTrack: signal.clusterCode as string,
        issuedAt: signal.issuedAt,
        expiresAt: signal.expiresAt,
        kid: publicKeyKid(),
        signalId,
      }),
    );
  }),
);

export default router;
