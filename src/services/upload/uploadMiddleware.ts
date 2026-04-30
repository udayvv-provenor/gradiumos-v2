/**
 * Upload middleware — multer + pdf-parse + text-paste passthrough.
 *
 * Endpoints accept EITHER:
 *   - multipart/form-data with field "file" (PDF or .txt up to 5 MB)
 *   - application/json with field "rawText": string (paste flow)
 *
 * Output (attached to req.uploadedDoc): { rawText, source, fileName? }.
 *
 * Files are persisted to {UPLOAD_DIR}/{ownerKind}/{ownerId}/<sha256>-<originalName>
 * for traceability; PDF text extraction happens in-memory before save.
 */
import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import pdfParse from 'pdf-parse';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = new Set(['application/pdf', 'text/plain']);

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new AppError('UPLOAD_BAD_TYPE', `Unsupported file type ${file.mimetype}. Allowed: PDF or plain text.`));
    }
    cb(null, true);
  },
});

export interface UploadedDoc {
  rawText:  string;
  source:   'paste' | 'pdf' | 'txt';
  fileName?: string;
  storedPath?: string;
  byteLength?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uploadedDoc?: UploadedDoc;
    }
  }
}

/** Multer single-file middleware for the field "file". */
export const acceptUpload: RequestHandler = memoryUpload.single('file');

/** Normaliser — runs after acceptUpload (or instead of it for JSON paste).
 *  Resolves req.uploadedDoc and forwards. Use as the second middleware on
 *  upload routes.
 */
export function normaliseUpload(ownerKind: 'institution' | 'employer'): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // Path 1: multipart with file
      if (req.file) {
        const buf = req.file.buffer;
        const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
        const ownerId = (req.auth?.inst || req.auth?.emp || 'anon');
        const dir = resolve(env.UPLOAD_DIR, ownerKind, ownerId);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const safeName = req.file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 80);
        const storedPath = join(dir, `${sha}-${safeName}`);
        writeFileSync(storedPath, buf);

        let rawText = '';
        if (req.file.mimetype === 'application/pdf') {
          const parsed = await pdfParse(buf);
          rawText = (parsed.text || '').trim();
          if (!rawText) {
            return next(new AppError('UPLOAD_PDF_EMPTY', 'PDF contained no extractable text. Try a text-based PDF or paste the content.'));
          }
        } else {
          rawText = buf.toString('utf-8').trim();
        }

        req.uploadedDoc = {
          rawText,
          source: req.file.mimetype === 'application/pdf' ? 'pdf' : 'txt',
          fileName: req.file.originalname,
          storedPath,
          byteLength: buf.length,
        };
        return next();
      }

      // Path 2: JSON paste — accept rawText OR text (portal uses `text`)
      const body = req.body as { rawText?: unknown; text?: unknown };
      const pasted = (typeof body?.rawText === 'string' ? body.rawText
                    : typeof body?.text === 'string'    ? body.text
                    : '').trim();
      if (pasted.length > 0) {
        req.uploadedDoc = { rawText: pasted, source: 'paste' };
        return next();
      }

      return next(new AppError('UPLOAD_REQUIRED', 'Either upload a file (field="file") or include rawText (or text) in the JSON body.'));
    } catch (err) {
      next(err);
    }
  };
}
