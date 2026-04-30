# GradiumOS Cluster Vocabulary

The 8 competency clusters that GradiumOS measures. Use these EXACT codes (C1, C2, ..., C8) when emitting any cluster reference. Names are for human reading only — codes are the contract.

## C1 — Core Technical Foundations
Data structures, algorithms, computational thinking, computer-science fundamentals. Knowledge that doesn't depend on a specific framework or stack — it transfers across languages and decades.

**Strong evidence:** named algorithms (Dijkstra, dynamic programming), Big-O reasoning, language fundamentals across multiple languages, graduate-level CS coursework.
**Weak evidence:** "knows Python" with no depth signal, listing frameworks without principles.

## C2 — Applied Problem Solving
Translating ambiguous problems into structured analytical solutions. Algorithmic reasoning under time pressure. Decomposition. Hypothesis-testing.

**Strong evidence:** competitive programming results, hackathon wins, debugging stories with measurable outcomes, Fermi-estimation work.
**Weak evidence:** generic "problem solver" claim without examples.

## C3 — Engineering Execution
Shipping production code. Version control, testing, debugging discipline, CI/CD, observability, delivery reliability. The craft of turning a working prototype into a system that survives.

**Strong evidence:** specific deploy improvements with numbers ("cut deploy time from 14 to 4 min"), test coverage metrics, on-call experience, infrastructure-as-code.
**Weak evidence:** "wrote tests" with no specifics.

## C4 — System & Product Thinking
Architecture trade-offs, system design, product-level reasoning. Understanding when to choose SQL vs NoSQL, monolith vs microservice, sync vs async. Connecting technical choices to user/business outcomes.

**Strong evidence:** design docs, scaling decisions with rationale, choices made AGAINST conventional wisdom with justification.
**Weak evidence:** listing AWS services without context.

## C5 — Communication & Collaboration
Written, verbal, cross-functional clarity. Technical writing, stakeholder updates, conflict navigation, productive disagreement.

**Strong evidence:** published writing, conference talks, evidence of cross-team work, stakeholder-management stories.
**Weak evidence:** "good communicator" claim with no artifacts.

## C6 — Domain Specialisation
Depth in a specific domain — fintech, ML, security, healthtech, edtech, gaming, devtools, etc. Going deep enough that domain knowledge becomes a moat.

**Strong evidence:** domain-specific certifications, papers, sustained work in one domain across multiple roles.
**Weak evidence:** brief exposure to many domains without depth in any.

## C7 — Ownership & Judgment
Initiative, delivery reliability under ambiguity, decision quality. The "what would you do without being told" muscle.

**Strong evidence:** founded/led initiatives, took on uninvited scope, post-mortems with self-criticism.
**Weak evidence:** title-based ownership claims ("Senior Engineer therefore owns things").

## C8 — Learning Agility
Speed picking up new tools, domains, contexts. Adapting when the ground shifts.

**Strong evidence:** specific stories of "I picked up X in N weeks/months", career pivots, multi-domain track records.
**Weak evidence:** long skill list with no story of acquisition.

---

## Scoring conventions (apply consistently across all tasks)

- All cluster scores are integers in `0..100`. NOT floats. NOT 0..10 or 0..1.
- All confidence values are floats in `0..1` to 2 decimal places.
- A score of 50 is "average / unclear". 70 is "above expectation". 85+ is "strong evidence". 30 or below is "weak / contradicting evidence".
- Confidence reflects evidence STRENGTH, not score certainty. Strong evidence with low score (e.g. resume openly says "no system design experience") still gets 0.7+ confidence — you're confident in the low score.
- A score of 50 with confidence 0.15 means "we're guessing — the resume said almost nothing".
