/**
 * fix-mojibake — repairs files where UTF-8 was previously decoded as
 * Windows-1252 then re-saved as UTF-8 (the classic "Set-Content -Encoding utf8"
 * round trip). Each byte of the original UTF-8 sequence ends up as a separate
 * Unicode codepoint matching the Windows-1252 representation of that byte.
 *
 * Mapping (the Win-1252 codepoints we see in the corrupted file → original):
 *   U+00E2 'â' + U+20AC '€' + U+009D ''        → never matches (0x9D unprinted)
 *   U+00E2 'â' + U+20AC '€' + U+201D '"'        → '—' (em dash, original 0xE2 0x80 0x94)
 *   U+00E2 'â' + U+20AC '€' + U+201C '"'        → '–' (en dash, was 0xE2 0x80 0x93)
 *   U+00E2 'â' + U+20AC '€' + U+201C '...wait
 *
 * The way to derive: take the original UTF-8 bytes of the intended char,
 * map each byte through Win-1252, get a 2 or 3-character mojibake string.
 *
 * Run: npx tsx scripts/fix-mojibake.ts
 *
 * Idempotent. Skips binary, node_modules, .git, dist, build, logs, uploads.
 */
import * as fs from 'fs';
import * as path from 'path';

// Build the mojibake → original map by running the corruption pipeline:
// for each char we want to recover, encode UTF-8, then map each byte through
// the Windows-1252 table, then take the resulting Unicode string.

// Windows-1252 byte → Unicode codepoint table.
// 0x00-0x7F = ASCII; 0xA0-0xFF = Latin-1 (mostly identity); 0x80-0x9F has specials.
const WIN1252: Record<number, number> = {};
for (let i = 0x00; i <= 0xFF; i++) WIN1252[i] = i;   // default identity
// Override 0x80-0x9F with the Win-1252 specials
const SPECIALS_80_9F: [number, number][] = [
  [0x80, 0x20AC], [0x82, 0x201A], [0x83, 0x0192], [0x84, 0x201E],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02C6],
  [0x89, 0x2030], [0x8A, 0x0160], [0x8B, 0x2039], [0x8C, 0x0152],
  [0x8E, 0x017D],
  [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201C], [0x94, 0x201D],
  [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02DC],
  [0x99, 0x2122], [0x9A, 0x0161], [0x9B, 0x203A], [0x9C, 0x0153],
  [0x9E, 0x017E], [0x9F, 0x0178],
];
for (const [b, cp] of SPECIALS_80_9F) WIN1252[b] = cp;

function corrupt(originalChar: string): string {
  const utf8Bytes = Buffer.from(originalChar, 'utf8');
  let out = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    const cp = WIN1252[utf8Bytes[i]];
    if (cp === undefined) return '';   // unmappable byte — skip
    out += String.fromCodePoint(cp);
  }
  return out;
}

// Characters we want to recover. These are the ones that appear in user-
// visible strings or in our prompt files.
const RECOVER = [
  '—', '–', '…', '‘', '’', '“', '”', '•', '«', '»',
  '←', '↑', '→', '↓', '⇐', '⇑', '⇒', '⇓',
  '≤', '≥', '≈', '≠', '±', '×', '÷',
  '§', '°', '·', '£', '©', '®', '½', '¼', '¾',
  '⚡', '▲', '▼', '◆', '◊', '◯', '■', '□', '●', '○',
  '★', '☆', '✓', '✗', '✎',
  ' ',   // non-breaking space → regular space cleanup
];

const FIX_MAP: [string, string][] = [];
for (const ch of RECOVER) {
  const bad = corrupt(ch);
  if (bad && bad !== ch && bad.length > 1) FIX_MAP.push([bad, ch === ' ' ? ' ' : ch]);
}
// Sort by length DESC so longer mojibake (3-char) replaces before 2-char prefixes
FIX_MAP.sort((a, b) => b[0].length - a[0].length);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'logs', 'uploads']);
const PROCESS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.md', '.json', '.html', '.css']);

function walk(dir: string, files: string[]) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), files);
    } else if (e.isFile() && PROCESS_EXTS.has(path.extname(e.name))) {
      files.push(path.join(dir, e.name));
    }
  }
}

function fixFile(file: string): number {
  let content: string;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  let updated = content;
  let totalReplacements = 0;
  for (const [bad, good] of FIX_MAP) {
    if (updated.includes(bad)) {
      const parts = updated.split(bad);
      totalReplacements += parts.length - 1;
      updated = parts.join(good);
    }
  }
  if (updated !== content) {
    fs.writeFileSync(file, updated, 'utf8');
    return totalReplacements;
  }
  return 0;
}

function main() {
  console.log('mojibake fix map (first 10):');
  for (const [bad, good] of FIX_MAP.slice(0, 10)) {
    const codes = [...bad].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
    console.log(`  "${bad}" (${codes}) → "${good}"`);
  }
  console.log(`(... ${FIX_MAP.length} total mappings)\n`);

  const roots = [
    'campus-app/src',
    'workforce-app/src',
    'talent-app/src',
    'demo-landing/src',
    'backend/src',
    'agents',
  ];
  const repoBase = path.resolve(process.cwd(), '..');
  let totalFiles = 0, totalChanged = 0, totalReps = 0;
  for (const r of roots) {
    const abs = path.join(repoBase, r);
    if (!fs.existsSync(abs)) continue;
    const files: string[] = [];
    walk(abs, files);
    for (const f of files) {
      totalFiles++;
      const n = fixFile(f);
      if (n > 0) {
        totalChanged++;
        totalReps += n;
        console.log(`  fixed: ${path.relative(repoBase, f)} (${n})`);
      }
    }
  }
  console.log(`\nscanned ${totalFiles} files, changed ${totalChanged}, total replacements: ${totalReps}`);
}
main();
