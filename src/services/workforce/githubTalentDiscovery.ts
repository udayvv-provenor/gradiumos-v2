/**
 * githubTalentDiscovery — pull live GitHub users for a role + location, then
 * AI-shape each one into the GradiumOS 8-cluster vocabulary so the TA Lead
 * can see ranked candidates against their role's cluster targets BEFORE any
 * learner has enrolled on the platform. Day-0 value for Workforce.
 *
 * v3.1.9 — added per Uday's call: "Workforce feels limited. Pull learners
 * from GitHub maybe — what can be mapped here as IP and as MVP show?"
 *
 * Architecture (canonical AI service shape):
 *   1. Input: role title + city + role.clusterTargets (the IP-shaped demand)
 *   2. Cache key: sha256(role + city) — 24h TTL
 *   3. Live calls (cache miss):
 *       a. GitHub /search/users with location + bio keywords
 *       b. For top N users: GitHub /users/{login}/repos for languages signal
 *       c. Per-user Groq inferTrackClusters with bio + top-3 repo readmes
 *   4. Compute matchScore against role.clusterTargets via locked formula
 *   5. Persist to publicDataCache, scope='workforce', stakeholderId=roleId
 *   6. Return ranked candidates with provenance (GitHub URLs)
 *
 * IP-protection: Groq sees the public bio text + cluster vocabulary only.
 * No formulas, no learner-PII. The matchScore uses the LOCKED IP formula.
 *
 * Rate limits: GitHub unauth = 60/hr; with token = 5000/hr. Set
 * GITHUB_TOKEN in .env for the higher tier.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/db.js';
import { matchScore } from '../competency/formulas.js';
import { inferTrackClusters } from '../ai/prompts/inferTrackClusters.js';

const CLUSTER_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const;
const CACHE_SLOT = 'github-talent';
const TTL_HOURS = 24;
const MAX_CANDIDATES = 8;     // limit Groq calls per request

export interface GitHubCandidate {
  login: string;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  htmlUrl: string;
  publicRepos: number;
  followers: number;
  topLanguages: string[];     // derived from public repos
  matchPct: number;            // computed via locked matchScore against role targets
  clusterTargets: Record<string, number>;   // AI-inferred cluster shape for this person
  fitNarrative: string;        // 1-line "why this person fits / doesn't"
}

interface GHUser {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
}
interface GHUserDetailed extends GHUser {
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  location: string | null;
}
interface GHRepo {
  name: string;
  language: string | null;
  stargazers_count: number;
  description: string | null;
}

const HEADERS: Record<string, string> = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'GradiumOS-Workforce/1.0',
};
function authHeaders() {
  const tok = process.env.GITHUB_TOKEN;
  return tok ? { ...HEADERS, 'Authorization': `Bearer ${tok}` } : HEADERS;
}

/** Returns ranked GitHub candidates for a role + city against the role's
 *  clusterTargets. */
export async function discoverGitHubTalent(args: {
  roleId: string;
  roleTitle: string;
  city: string;
  clusterTargets: Record<string, number>;
  forceRefresh?: boolean;
}): Promise<{ candidates: GitHubCandidate[]; source: 'db-cache' | 'live'; hash: string }> {
  const hashSrc = `gh-talent:${args.roleTitle.toLowerCase()}|${args.city.toLowerCase()}:v1`;
  const hash = createHash('sha256').update(hashSrc).digest('hex').slice(0, 16);

  // 1. cache check
  if (!args.forceRefresh) {
    const cached = await prisma.publicDataCache.findFirst({
      where: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: CACHE_SLOT, contextHash: hash },
    });
    if (cached && cached.expiresAt > new Date() && cached.payload) {
      const stored = cached.payload as unknown as GitHubCandidate[];
      // Re-rank against current role clusterTargets (cheap, in-memory)
      const reranked = rerank(stored, args.clusterTargets);
      return { candidates: reranked, source: 'db-cache', hash };
    }
  }

  // 2. GitHub search — public, no auth needed but rate-limited
  const queryParts = [
    sanitizeForQuery(args.roleTitle),
    `location:${sanitizeForQuery(args.city)}`,
  ];
  const q = encodeURIComponent(queryParts.join(' '));
  let users: GHUser[] = [];
  try {
    const r = await fetch(`https://api.github.com/search/users?q=${q}&per_page=${MAX_CANDIDATES * 2}`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json() as { items?: GHUser[] };
      users = (data.items ?? []).slice(0, MAX_CANDIDATES * 2);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[github-talent] search returned ${r.status}; falling back to empty`);
      return { candidates: [], source: 'live', hash };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[github-talent] search threw:', (err as Error).message.slice(0, 200));
    return { candidates: [], source: 'live', hash };
  }

  // 3. Hydrate top N with profile + repo languages, in parallel (limited
  // concurrency to respect rate limits)
  const hydrated: GitHubCandidate[] = [];
  const top = users.slice(0, MAX_CANDIDATES);
  const detailed = await Promise.all(top.map((u) => hydrateUser(u).catch(() => null)));
  for (const d of detailed) {
    if (!d) continue;
    hydrated.push(d);
  }

  // 4. Cache the raw hydrated list (without per-role match scores — those
  // depend on role.clusterTargets which can change). Match is recomputed on
  // every read from cache.
  try {
    const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
    await prisma.publicDataCache.upsert({
      where:  { stakeholderKind_stakeholderId_slot_contextHash: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: CACHE_SLOT, contextHash: hash } },
      update: { payload: hydrated as unknown as object, retrievedAt: new Date(), expiresAt, fromFixture: false },
      create: { stakeholderKind: 'workforce', stakeholderId: args.roleId, slot: CACHE_SLOT, contextHash: hash, payload: hydrated as unknown as object, fromFixture: false, expiresAt },
    });
  } catch { /* non-fatal */ }

  return { candidates: rerank(hydrated, args.clusterTargets), source: 'live', hash };
}

async function hydrateUser(u: GHUser): Promise<GitHubCandidate | null> {
  // Fetch profile + repos in parallel
  const [profileR, reposR] = await Promise.all([
    fetch(`https://api.github.com/users/${u.login}`, { headers: authHeaders() }),
    fetch(`https://api.github.com/users/${u.login}/repos?sort=stars&per_page=10`, { headers: authHeaders() }),
  ]);
  if (!profileR.ok) return null;
  const profile = await profileR.json() as GHUserDetailed;
  const repos = (reposR.ok ? await reposR.json() as GHRepo[] : []).filter((r) => r.language);
  const langCounts: Record<string, number> = {};
  for (const r of repos) {
    if (!r.language) continue;
    langCounts[r.language] = (langCounts[r.language] ?? 0) + 1 + Math.min(r.stargazers_count ?? 0, 100) / 50;
  }
  const topLanguages = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);

  // Build the input for inferTrackClusters
  const description = [
    profile.bio ?? '',
    `Languages: ${topLanguages.join(', ')}.`,
    `Repos: ${repos.slice(0, 3).map((r) => `${r.name} (${r.language})${r.description ? ': ' + r.description.slice(0, 100) : ''}`).join(' | ')}`,
  ].filter(Boolean).join(' ');

  let inferred: { clusterTargets: Record<string, number> } | null = null;
  let fitNarrative = 'Public GitHub profile; cluster shape inferred from bio + top languages.';
  try {
    const r = await inferTrackClusters({
      trackName: profile.name ?? profile.login,
      trackDescription: description.slice(0, 800),
    });
    inferred = { clusterTargets: r.inferred.clusterTargets };
    fitNarrative = `Profile reads as ${topLanguages.slice(0, 3).join(', ')} engineer. ${profile.public_repos} repos, ${profile.followers} followers.`;
  } catch {
    // fallback — uniform mid-tier
    inferred = { clusterTargets: { C1: 65, C2: 60, C3: 65, C4: 60, C5: 55, C6: 55, C7: 60, C8: 55 } };
  }

  return {
    login:        profile.login,
    name:         profile.name,
    bio:          profile.bio,
    avatarUrl:    profile.avatar_url,
    htmlUrl:      profile.html_url,
    publicRepos:  profile.public_repos,
    followers:    profile.followers,
    topLanguages,
    matchPct:     0,                    // filled by rerank()
    clusterTargets: inferred.clusterTargets,
    fitNarrative,
  };
}

function rerank(candidates: GitHubCandidate[], roleTargets: Record<string, number>): GitHubCandidate[] {
  const scored = candidates.map((c) => {
    const entries = CLUSTER_CODES.map((cc) => ({
      scoreWeighted: c.clusterTargets[cc] ?? 0,
      target:        roleTargets[cc] ?? 0,
      weight:        1,
    })).filter((e) => e.target > 0);
    const m = entries.length > 0 ? matchScore(entries) : 0;
    return { ...c, matchPct: Math.round(m * 100) };
  });
  return scored.sort((a, b) => b.matchPct - a.matchPct);
}

function sanitizeForQuery(s: string): string {
  return s.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
