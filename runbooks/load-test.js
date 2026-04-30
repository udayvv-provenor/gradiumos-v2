/**
 * BC 179 — GradiumOS v3 k6 Load Test
 *
 * Run:
 *   k6 run load-test.js \
 *     -e BASE_URL=http://localhost:4002 \
 *     -e TOKENS_FILE=/path/to/lt-tokens.json
 *
 * TOKENS_FILE is a JSON object with keys "talent", "workforce", "campus",
 * each an array of JWT tokens. VUs pick tokens by index (__VU % pool_size)
 * so each user gets a dedicated rate-limit bucket.
 *
 * Traffic split: 40% Talent | 35% Workforce | 25% Campus
 * Thresholds: p95 < 2000ms, error rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://localhost:4002';

// Load token pools — each VU picks a token by ((__VU - 1) % pool.length)
const tokenFile = __ENV.TOKENS_FILE || '';
let talentTokens = [''];
let workforceTokens = [''];
let campusTokens = [''];

if (tokenFile) {
  const pools = new SharedArray('tokens', function () {
    return [JSON.parse(open(tokenFile))];
  });
  talentTokens    = pools[0].talent    || [''];
  workforceTokens = pools[0].workforce || [''];
  campusTokens    = pools[0].campus    || [''];
}

// Pre-seeded IDs for parameterised endpoints — override via env if needed.
const WORKFORCE_ROLE_ID  = __ENV.WORKFORCE_ROLE_ID  || 'seed-role-001';
const CAMPUS_TRACK_ID    = __ENV.CAMPUS_TRACK_ID    || 'seed-track-001';

export const options = {
  vus: 100,
  duration: '2m',
  thresholds: {
    'http_req_duration{scenario:talent}':    ['p(95)<2000'],
    'http_req_duration{scenario:workforce}': ['p(95)<2000'],
    'http_req_duration{scenario:campus}':    ['p(95)<2000'],
    http_req_duration: ['p(95)<2000'],
    http_req_failed:   ['rate<0.01'],
  },
};

function talentScenario() {
  const token = talentTokens[(__VU - 1) % talentTokens.length];
  const params = {
    headers: { Authorization: `Bearer ${token}` },
    tags:    { scenario: 'talent' },
  };

  // Health check (public — no auth needed, but keep headers for consistency)
  const health = http.get(`${BASE}/api/v1/health`, { tags: { scenario: 'talent' } });
  check(health, { '[talent] health 200': (r) => r.status === 200 });

  sleep(0.3);

  // Learner signal export
  const signal = http.get(`${BASE}/api/v1/talent/me/signal`, params);
  check(signal, { '[talent] signal 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(0.5);
}

function workforceScenario() {
  const token = workforceTokens[(__VU - 1) % workforceTokens.length];
  const params = {
    headers: { Authorization: `Bearer ${token}` },
    tags:    { scenario: 'workforce' },
  };

  // Role calibrate (exists; 200 for any TA_LEAD, 404 when ID missing — both acceptable)
  const calibrate = http.get(`${BASE}/api/v1/workforce/roles/${WORKFORCE_ROLE_ID}/calibrate`, params);
  check(calibrate, { '[workforce] calibrate 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(0.3);

  // Role pipeline
  const pipeline = http.get(`${BASE}/api/v1/workforce/roles/${WORKFORCE_ROLE_ID}/pipeline`, params);
  check(pipeline, { '[workforce] pipeline 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(0.5);
}

function campusScenario() {
  const token = campusTokens[(__VU - 1) % campusTokens.length];
  const params = {
    headers: { Authorization: `Bearer ${token}` },
    tags:    { scenario: 'campus' },
  };

  // Gap report for a career track
  const gap = http.get(`${BASE}/api/v1/campus/career-tracks/${CAMPUS_TRACK_ID}/gap`, params);
  check(gap, { '[campus] gap 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(0.3);

  // Cohort for a career track (exists alongside /gap)
  const cohort = http.get(`${BASE}/api/v1/campus/career-tracks/${CAMPUS_TRACK_ID}/cohort`, params);
  check(cohort, { '[campus] cohort 200 or 404': (r) => r.status === 200 || r.status === 404 });

  sleep(0.5);
}

export default function () {
  // Weighted dispatch: 40% talent, 35% workforce, 25% campus
  const roll = Math.random();
  if (roll < 0.40) {
    talentScenario();
  } else if (roll < 0.75) {
    workforceScenario();
  } else {
    campusScenario();
  }
}
