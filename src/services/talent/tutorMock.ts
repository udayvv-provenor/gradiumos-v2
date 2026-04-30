/**
 * Deterministic tutor reply generator. Zero external calls.
 * Reply shape:
 *   "**{subtopic.name}** — {explanation}. Here's a concrete example: {example}. Try this: {follow-up}"
 * Rotates the {example, follow-up} pair based on the turn index using det01(sessionId + turn).
 */
import type { ClusterCode } from '@prisma/client';
import { det01 } from './helpers.js';

interface SubtopicLike { code: string; clusterCode: ClusterCode; name: string }

// Canonical explanation/example/follow-up sets keyed on subtopic.code.
// Generic fallback kicks in if the code is unknown.
interface TutorVeins { explanations: string[]; examples: string[]; followUps: string[] }

const VEINS: Record<string, TutorVeins> = {
  'C1.BIG-O': {
    explanations: [
      'Big-O describes how the work an algorithm does grows as its input grows, ignoring constants and lower-order terms. Two O(n) algorithms may differ by 10x in practice, but only n-shape matters at asymptotic scale.',
      'The important distinction is worst-case vs expected-case vs amortized. Hash-table get() is O(1) amortized but O(n) worst case during a collision storm.',
      'Analysis starts from the inner-most loop outward: count iterations per layer, then multiply them to get an upper bound.',
    ],
    examples: [
      'For `for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) work(); }`, the total call count is n*n — clearly O(n^2).',
      'Merging two sorted arrays of length n and m is O(n + m): each pointer only advances forward, one step per comparison.',
      'Dynamic array append is amortized O(1) because the cost of an occasional double-and-copy is paid back over n cheap appends.',
    ],
    followUps: [
      'Can you name a common interview problem where an O(n^2) brute force becomes O(n log n) with a sort?',
      'What is the worst-case complexity of a naive recursive Fibonacci, and why?',
      'Why is amortized analysis honest even though an individual operation may be expensive?',
    ],
  },
  'C2.DP': {
    explanations: [
      'Dynamic programming applies when a problem has optimal substructure and overlapping subproblems. If the same subproblem recurs, memoizing it collapses exponential work into polynomial work.',
      'Every DP has two critical ingredients: a state definition (what are we keeping?) and a transition (how does a state derive from smaller states?).',
      'Top-down (memoized recursion) and bottom-up (iterative tabulation) are semantically equivalent; pick whichever makes the transition easier to write.',
    ],
    examples: [
      'Fibonacci — f(n) = f(n-1) + f(n-2) — is the smallest DP. Memo collapses O(2^n) to O(n).',
      'Longest common subsequence has state (i, j) = "best LCS of A[0..i] and B[0..j]". The transition branches on whether A[i] == B[j].',
      'Coin change minimum coins: state = remaining amount; transition = min over each coin.',
    ],
    followUps: [
      'Write the state and transition for 0/1 knapsack — what makes it different from unbounded knapsack?',
      'When is top-down memoization preferable to bottom-up?',
      'Give an example where DP is too expensive and greedy works; justify why.',
    ],
  },
  'C3.DEBUG': {
    explanations: [
      'Systematic debugging is about narrowing the search space faster than random guessing. The fastest debuggers form a hypothesis, design a test to falsify it, and only then touch code.',
      'Reproduce first. A bug you cannot reproduce reliably is a bug you cannot fix reliably.',
      'Bisect aggressively: git bisect in code, binary search in data, halving in logs.',
    ],
    examples: [
      'A production 500 starts at 14:02 UTC. The deploy at 13:50 is the first hypothesis; git bisect on the diff finds the bad change.',
      'A flaky test: print the RNG seed on every run, then run 1000 times with and without a suspect commit.',
      'An intermittent null-pointer on one customer: filter logs by that customer and you see the race between two requests.',
    ],
    followUps: [
      'When would you reach for a debugger vs just adding logs?',
      'What does "working backward from symptom" look like for a silent data-corruption bug?',
      'How do you avoid fixing the symptom while missing the root cause?',
    ],
  },
};

// Generic veins used when the subtopic is unknown.
const GENERIC: TutorVeins = {
  explanations: [
    'This topic rewards structured thinking more than memorising trivia — you should be able to derive the key ideas from first principles.',
    'The way professionals talk about this topic is in terms of tradeoffs: what do you gain, what do you pay, and when is the tradeoff worth it?',
    'Most interview failures on this topic come from jumping to a solution without first naming the constraint that forces the solution.',
  ],
  examples: [
    'Consider a scenario where the volume is 10x what you expect — does your approach still hold?',
    'Take the smallest non-trivial instance of this problem and solve it by hand before touching code.',
    'Sketch the two-line summary of the approach, then invite a peer to poke holes before you implement.',
  ],
  followUps: [
    'Pick one of the examples above and trace it end-to-end — where do you get stuck?',
    'What is a closely adjacent topic where the core idea fails, and why?',
    'Explain the core concept back to me as if I were a junior engineer who has not seen it before.',
  ],
};

function pickRotating(list: string[], seed: string, turnIdx: number): string {
  if (list.length === 0) return '';
  const key = seed + '#turn-' + turnIdx.toString();
  const idx = Math.floor(det01(key) * list.length);
  return list[idx % list.length];
}

export function openingMessage(subtopic: SubtopicLike): string {
  const veins = VEINS[subtopic.code] ?? GENERIC;
  const seed = 'open|' + subtopic.code;
  const explanation = pickRotating(veins.explanations, seed, 0);
  const example = pickRotating(veins.examples, seed, 1);
  const followUp = pickRotating(veins.followUps, seed, 2);
  return `**${subtopic.name}** — ${explanation} Here's a concrete example: ${example} Try this: ${followUp}`;
}

export function tutorReply(subtopic: SubtopicLike, sessionId: string, turnIdx: number): string {
  const veins = VEINS[subtopic.code] ?? GENERIC;
  const seed = sessionId;
  const explanation = pickRotating(veins.explanations, seed + '|exp', turnIdx);
  const example = pickRotating(veins.examples, seed + '|ex', turnIdx);
  const followUp = pickRotating(veins.followUps, seed + '|fu', turnIdx);
  return `**${subtopic.name}** — ${explanation} Here's a concrete example: ${example} Try this: ${followUp}`;
}
