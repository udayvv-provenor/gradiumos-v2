import type { Request, Response } from 'express';
import { publicKeyHex, publicKeyKid } from '../services/signal/tokenSigner.js';

export async function getPublicKey(_req: Request, res: Response) {
  res.json({
    alg: 'Ed25519',
    kid: publicKeyKid(),
    publicKeyHex: publicKeyHex(),
    issuer: 'gradium-signal',
    description: 'Public key used to verify portable GradiumOS Signal tokens.',
  });
}
