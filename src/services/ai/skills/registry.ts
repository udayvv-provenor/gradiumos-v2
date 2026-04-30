/**
 * Skill Registry — composes Markdown skill files into a single system prompt.
 *
 * The IP layer of GradiumOS's AI behaviour. Each task file declares (in YAML
 * frontmatter) which foundation / voice / schema files it composes from. The
 * compiler reads them in order, strips the frontmatter, and emits a single
 * system prompt.
 *
 * Why this matters:
 *   - SHARED VOCABULARY: cluster-vocabulary.md is loaded by every task that
 *     touches clusters. Change the definition once → every AI call updates.
 *   - VERSIONABLE: each file has a version. Bumping cluster-vocabulary.md
 *     from 1.0.0 → 1.1.0 makes it explicit which downstream tasks need
 *     re-validation.
 *   - AUDITABLE: `compileSkill('extract-jd')` returns the EXACT prompt sent
 *     to the LLM. Run it in a REPL, paste into a debugger, diff against
 *     a previous version.
 *   - DEFENSIBLE: the IP isn't the inline TS strings; it's the structured
 *     library of voices + schemas + tasks. Hard to copy without copying
 *     the whole approach.
 *   - IP-PROTECTION CHECKED: registry validates that no foundation/voice/
 *     schema file contains forbidden tokens (CRB constants, etc.).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

const SKILLS_DIR = resolve(process.cwd(), 'src', 'services', 'ai', 'skills');

/* Forbidden tokens — sourced from the existing groqClient.ts redact() guard.
 * These must never appear in any compiled skill prompt. */
const FORBIDDEN_TOKENS = [
  'DECAY=0.8',
  'FRESHNESS_WINDOW_DAYS=180',
  'SUPPRESSION_CONFIDENCE',
  'completeness * 0.35',
  '0.35 * completeness',
  'archetypeWeights',
  'IndexVersion',
];

interface ParsedSkillFile {
  frontmatter: { compose?: string[]; version?: string; task?: string };
  body: string;
}

/* In-process cache — disabled in development so editing a .md skill file
 * takes effect on next request without a process restart. Skill files are
 * small (single-digit KB each) so the fs cost is negligible. */
const _cache = new Map<string, ParsedSkillFile>();
const _cachingEnabled = process.env.NODE_ENV === 'production';

function parseFile(absPath: string): ParsedSkillFile {
  if (_cachingEnabled && _cache.has(absPath)) return _cache.get(absPath)!;
  const raw = readFileSync(absPath, 'utf-8');
  // Frontmatter is between `---` and `---` at start of file (YAML-lite — we only need
  // `compose: [list]`, `version: x.y.z`, `task: name`)
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    _cache.set(absPath, { frontmatter: {}, body: raw });
    return { frontmatter: {}, body: raw };
  }
  const fm = fmMatch[1];
  const body = fmMatch[2];
  const frontmatter: ParsedSkillFile['frontmatter'] = {};
  // Crude YAML parse — `compose:` followed by `  - path` lines, `version: x.y.z`, `task: name`
  const composeMatch = fm.match(/compose:\n((?:\s+-\s+\S+\n?)+)/);
  if (composeMatch) {
    frontmatter.compose = composeMatch[1].split('\n')
      .map((l) => l.replace(/^\s+-\s+/, '').trim())
      .filter(Boolean);
  }
  const versionMatch = fm.match(/version:\s*(\S+)/);
  if (versionMatch) frontmatter.version = versionMatch[1];
  const taskMatch = fm.match(/task:\s*(\S+)/);
  if (taskMatch) frontmatter.task = taskMatch[1];

  const parsed = { frontmatter, body };
  if (_cachingEnabled) _cache.set(absPath, parsed);
  return parsed;
}

function checkForbiddenTokens(content: string, sourceFile: string): void {
  for (const tok of FORBIDDEN_TOKENS) {
    if (content.includes(tok)) {
      throw new Error(
        `[skill-registry] Forbidden IP token "${tok}" found in skill file ${sourceFile}. ` +
        `Foundation/voice/schema files must NOT include CRB formula constants.`,
      );
    }
  }
}

/**
 * Compile a task into its full system prompt. Reads the task file's
 * frontmatter, loads each `compose` dependency in order, strips frontmatter
 * from each, and concatenates with `---` separators.
 *
 * @param taskName e.g. 'extract-jd' (matches a file at tasks/{taskName}.md)
 * @returns the full system prompt as a single string
 */
export function compileSkill(taskName: string): string {
  const taskPath = join(SKILLS_DIR, 'tasks', `${taskName}.md`);
  const task = parseFile(taskPath);

  const composedParts: string[] = [];
  for (const dep of task.frontmatter.compose ?? []) {
    const depPath = join(SKILLS_DIR, dep);
    const depFile = parseFile(depPath);
    checkForbiddenTokens(depFile.body, dep);
    composedParts.push(depFile.body.trim());
  }
  // Task body last (its specific instructions override / extend the foundation)
  checkForbiddenTokens(task.body, `tasks/${taskName}.md`);
  composedParts.push(task.body.trim());

  return composedParts.join('\n\n---\n\n');
}

/** Returns metadata about a compiled skill — useful for logging + debugging. */
export function describeSkill(taskName: string): {
  task: string;
  version: string;
  composedFrom: string[];
  promptHash: string;
  promptLength: number;
} {
  const taskPath = join(SKILLS_DIR, 'tasks', `${taskName}.md`);
  const task = parseFile(taskPath);
  const compiled = compileSkill(taskName);
  return {
    task: taskName,
    version: task.frontmatter.version ?? 'unknown',
    composedFrom: task.frontmatter.compose ?? [],
    promptHash: createHash('sha256').update(compiled).digest('hex').slice(0, 12),
    promptLength: compiled.length,
  };
}

/** List all available task skills. */
export function listSkills(): string[] {
  const tasksDir = join(SKILLS_DIR, 'tasks');
  return readdirSync(tasksDir)
    .filter((f) => f.endsWith('.md') && statSync(join(tasksDir, f)).isFile())
    .map((f) => f.replace(/\.md$/, ''));
}

/** Validate every task compiles + passes IP checks. Run this at boot or in CI. */
export function validateAllSkills(): { ok: boolean; results: { task: string; ok: boolean; error?: string }[] } {
  const results = listSkills().map((task) => {
    try {
      compileSkill(task);
      return { task, ok: true };
    } catch (err) {
      return { task, ok: false, error: (err as Error).message };
    }
  });
  return { ok: results.every((r) => r.ok), results };
}
