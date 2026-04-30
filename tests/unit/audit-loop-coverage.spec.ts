/**
 * BC 165 — Audit loop coverage (static string-grep test).
 *
 * Verifies that all marquee closed-loop audit action strings are present
 * somewhere in the src/ directory. This is NOT a DB test — it reads source
 * files and asserts the literal action strings exist.
 *
 * Rationale: if someone renames an action string without updating it
 * everywhere, this test catches the gap before it reaches production.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

describe('Audit loop coverage (BC 165)', () => {
  const REQUIRED_ACTIONS = [
    'pathway_assigned',
    'score_recomputed',
    'application_created',
    'application_status_changed',
    'role_status_changed',
  ];

  it('all marquee loop audit actions exist in the codebase', () => {
    const srcDir = join(process.cwd(), 'src');

    function collectFiles(dir: string): string[] {
      const entries = readdirSync(dir);
      const files: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          files.push(...collectFiles(full));
        } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
          files.push(full);
        }
      }
      return files;
    }

    const allSource = collectFiles(srcDir)
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    for (const action of REQUIRED_ACTIONS) {
      expect(allSource, `'${action}' must appear as an AuditLog action string in src/`).toContain(action);
    }
  });
});
