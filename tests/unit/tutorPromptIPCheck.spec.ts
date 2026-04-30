import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('tutor prompt IP protection (BC 75)', () => {
  it('tutorChat prompt does not contain formula constants or weights', () => {
    // Read the actual prompt template file
    const promptPath = join(process.cwd(), 'src/services/ai/prompts/tutorChat.ts');
    const content = readFileSync(promptPath, 'utf8');

    const forbidden = [
      'DECAY',
      'FRESHNESS_WINDOW',
      '0.35',           // completeness weight
      '0.20',           // sufficiency weight
      '0.15',           // consistency weight
      'suppression',
      'SUPPRESSION',
      'learnerScore',   // IP rule #2: no raw numeric cluster scores in Groq prompts
      'scoreWeighted',  // same — computed formula output must not reach Groq
    ];

    for (const token of forbidden) {
      expect(content, `Prompt must not contain '${token}'`).not.toContain(token);
    }
  });
});
