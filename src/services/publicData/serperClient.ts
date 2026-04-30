/**
 * serperClient — single-source-per-query wrapper around Serper Google Search API.
 *
 * Per Uday's call: each query targets ONE trusted source (named in the
 * query string, e.g. "AI jobs Bangalore naukri"). We take the first
 * non-sponsored organic result and pass it to the AI synth layer.
 *
 * Fixture mode: when SERPER_API_KEY is unset / placeholder, the client
 * reads from `fixtures/` JSON files keyed by query type. This lets us
 * exercise the entire downstream pipeline (caching, AI synthesis, UI
 * rendering) WITHOUT spending API credits during dev or failing tests
 * in environments without a key.
 *
 * IP protection: outbound query strings are constructed from the user's
 * stakeholder context (career track, city, institution name) ONLY.
 * Never include cluster scores, formula constants, learner names, or
 * any internal IP in the search URL.
 */
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const FIXTURES_DIR = resolve(process.cwd(), 'src', 'services', 'publicData', 'fixtures');
const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const SERPER_NEWS_ENDPOINT = 'https://google.serper.dev/news';

export type QueryType =
  | 'open-roles-naukri'
  | 'open-roles-linkedin'
  | 'salary-ambitionbox'
  | 'salary-glassdoor'
  | 'institution-nirf'
  | 'institution-naac'
  | 'institution-placement-record'
  | 'institution-overview'      // v3.1 — broader self-profile query, no site: restriction
  | 'employer-profile'          // v3.1 — employer self-profile (hiring footprint)
  | 'employer-glassdoor'        // v3.1 — employer reputation snapshot
  | 'peer-placement-benchmark'
  | 'top-hirers-from-peers'
  | 'competitor-jds-naukri'
  | 'competitor-jds-linkedin'
  | 'sourcing-pools-nirf'
  | 'hiring-news';

export interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;       // attribution source name (naukri, linkedin, etc.)
  sponsored?: boolean;
  position?: number;
}

export interface SerperSearchResponse {
  query: string;
  queryType: QueryType;
  topResult: SerperOrganicResult | null;       // first non-sponsored organic
  allResults: SerperOrganicResult[];           // for debugging — usually unused downstream
  retrievedAt: string;                          // ISO date
  fromFixture: boolean;
}

/** Whether a real Serper API key is configured. */
export function isSerperConfigured(): boolean {
  const k = process.env.SERPER_API_KEY;
  return Boolean(k && k !== 'YOUR_SERPER_KEY_HERE' && k.length >= 20);
}

/** Build the query string for a given query type + context.
 *  ONE source per query — name the source in the string per the rule. */
export function buildQuery(qt: QueryType, ctx: Record<string, string>): string {
  const c = ctx;
  switch (qt) {
    // v3.1.9 — site:-restricted queries return real job postings instead of
    // articles / company landing pages. Big quality bump for Opportunities.
    case 'open-roles-naukri':           return `${c.role ?? 'Software Engineer'} jobs ${c.city ?? 'India'} site:naukri.com`;
    case 'open-roles-linkedin':         return `${c.role ?? 'Software Engineer'} jobs ${c.city ?? 'India'} site:linkedin.com/jobs`;
    case 'salary-ambitionbox':          return `"${c.role ?? 'Software Engineer'}" salary ${c.city ?? 'India'} ambitionbox`;
    case 'salary-glassdoor':            return `"${c.role ?? 'Software Engineer'}" salary ${c.city ?? 'India'} glassdoor`;
    // v3.1 — site: restriction was too tight; nirfindia.org doesn't index every
    // institution's profile page directly. Drop the restriction and let Serper
    // surface aggregator pages (collegedunia, careers360, shiksha) which DO
    // index the NIRF rank text. Same for NAAC.
    case 'institution-nirf':            return `${c.institution ?? ''} NIRF ranking ${c.year ?? '2024'} engineering`;
    case 'institution-naac':            return `${c.institution ?? ''} NAAC grade accreditation`;
    case 'institution-placement-record': return `${c.institution ?? ''} placement record ${c.year ?? '2024'} OR ${c.year ?? '2025'} CSE`;
    case 'institution-overview':        return `${c.institution ?? ''} engineering college NIRF rank placement`;
    case 'employer-profile':            return `${c.employer ?? ''} hiring careers India ${c.year ?? '2026'}`;
    case 'employer-glassdoor':          return `${c.employer ?? ''} reviews glassdoor ambitionbox India`;
    case 'peer-placement-benchmark':    return `NIRF tier-${c.tier ?? '1'} ${c.track ?? 'CSE'} placement rate ${c.year ?? '2024'}`;
    case 'top-hirers-from-peers':       return `top recruiters from NIRF tier-${c.tier ?? '1'} ${c.track ?? 'CSE'} colleges ${c.year ?? '2024'}`;
    case 'competitor-jds-naukri':       return `"${c.role ?? 'Senior Backend Engineer'}" "${c.archetype ?? 'Product'}" naukri`;
    case 'competitor-jds-linkedin':     return `"${c.role ?? 'Senior Backend Engineer'}" "${c.archetype ?? 'Product'}" linkedin`;
    case 'sourcing-pools-nirf':         return `top ${c.track ?? 'CSE'} colleges India placement ${c.year ?? '2024'} NIRF`;
    case 'hiring-news':                 return `${c.domain ?? 'tech'} hiring trends India ${c.year ?? '2026'} economictimes OR livemint OR inc42`;
  }
}

/** Issue ONE search query against Serper (or fixture). Returns top non-sponsored organic. */
export async function serperSearch(qt: QueryType, ctx: Record<string, string>): Promise<SerperSearchResponse> {
  const query = buildQuery(qt, ctx);
  const retrievedAt = new Date().toISOString().slice(0, 10);

  if (!isSerperConfigured()) {
    return loadFixture(qt, query, retrievedAt);
  }

  // Real Serper call
  const isNewsQuery = qt === 'hiring-news';
  const endpoint = isNewsQuery ? SERPER_NEWS_ENDPOINT : SERPER_ENDPOINT;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num: 10 }),
  });
  if (!res.ok) throw new Error(`Serper ${qt} failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json() as { organic?: SerperOrganicResult[]; news?: SerperOrganicResult[] };
  const items = (isNewsQuery ? data.news : data.organic) ?? [];
  // Filter sponsored, take first organic
  const organic = items.filter((r) => !r.sponsored);
  return {
    query,
    queryType: qt,
    topResult: organic[0] ?? null,
    allResults: organic.slice(0, 5),
    retrievedAt,
    fromFixture: false,
  };
}

/** Issue MULTIPLE queries in parallel — used by the marketIntel synth layer. */
export async function serperSearchBatch(queries: { qt: QueryType; ctx: Record<string, string> }[]): Promise<SerperSearchResponse[]> {
  return Promise.all(queries.map(({ qt, ctx }) => serperSearch(qt, ctx)));
}

/* ─── Fixture loader ─────────────────────────────────────────────── */

function loadFixture(qt: QueryType, query: string, retrievedAt: string): SerperSearchResponse {
  const fixturePath = join(FIXTURES_DIR, `${qt}.json`);
  if (!existsSync(fixturePath)) {
    return { query, queryType: qt, topResult: null, allResults: [], retrievedAt, fromFixture: true };
  }
  try {
    const raw = readFileSync(fixturePath, 'utf-8');
    const data = JSON.parse(raw) as { organic: SerperOrganicResult[] };
    const organic = (data.organic ?? []).filter((r) => !r.sponsored);
    return {
      query,
      queryType: qt,
      topResult: organic[0] ?? null,
      allResults: organic.slice(0, 5),
      retrievedAt,
      fromFixture: true,
    };
  } catch {
    return { query, queryType: qt, topResult: null, allResults: [], retrievedAt, fromFixture: true };
  }
}
