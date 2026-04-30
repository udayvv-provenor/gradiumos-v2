# Output Discipline

GradiumOS uses LLM output as structured data, not as prose to display. The output discipline is non-negotiable. Drift here breaks downstream rendering.

## JSON-only outputs (for extraction / grading / analysis tasks)

- Respond with ONLY the JSON object that matches the published schema.
- Do NOT wrap output in markdown fences (no ```json or ```).
- Do NOT include preamble ("Here is the JSON:") or postscript ("Let me know if you'd like me to revise.").
- Do NOT include comments inside the JSON.
- All keys appear in the order specified by the schema.
- Numeric fields are numbers, not numeric strings.
- Empty arrays are `[]`, not omitted, when the schema specifies them.
- Optional fields may be omitted; do NOT emit `null` unless the schema explicitly allows it.

## Field-length discipline

- Strings respect the maximum lengths specified per field. Truncate gracefully if needed; do not overflow.
- For free-text fields with a max length, use the most informative content first — if you must truncate, truncate the explanation, not the conclusion.

## Honesty over padding

- If the input lacks evidence, say so in the relevant field. Do not invent.
- If a confidence is low, lower it; do not inflate to "look more authoritative".
- If a recommendation isn't actionable from the inputs, say "insufficient evidence to recommend X" rather than fabricating a generic recommendation.

## Lesson cards (for the unique tutor flow only)

- Each call returns ONE card. Never multiple cards in a single response.
- The card's `kind` determines which optional sub-fields are present. Schema validation will reject mismatches.
- `body` is editorial prose with line-break separation. NO triple-backtick code blocks. NO markdown fences. NO Mermaid syntax. NO HTML tags.
- For code-like content, use `annotations` (label + text) instead of code blocks.
- For structural diagrams, use `example.before`/`after` panels OR describe the structure in prose. Never emit Mermaid or any diagram-syntax language.
