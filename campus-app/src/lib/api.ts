import type { AuthTokens, User } from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4002'

/* ─── Token storage ────────────────────────────────────────────────────── */

function getTokens(): AuthTokens | null {
  const a = localStorage.getItem('accessToken')
  const r = localStorage.getItem('refreshToken')
  if (!a || !r) return null
  return { accessToken: a, refreshToken: r }
}

export function setTokens(tokens: AuthTokens) {
  localStorage.setItem('accessToken', tokens.accessToken)
  localStorage.setItem('refreshToken', tokens.refreshToken)
}

export function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
}

/* ─── Backend envelope ─────────────────────────────────────────────────── */

interface Envelope<T> {
  data: T | null
  error: { code: string; message: string; details?: unknown } | null
}

function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope.error) {
    const err = new Error(envelope.error.message || envelope.error.code) as Error & { code?: string }
    err.code = envelope.error.code
    throw err
  }
  if (envelope.data === null || envelope.data === undefined) {
    throw new Error('Empty response from server')
  }
  return envelope.data
}

/* ─── Auth flow ────────────────────────────────────────────────────────── */

async function refreshTokens(): Promise<AuthTokens | null> {
  const tokens = getTokens()
  if (!tokens) return null
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
  if (!res.ok) return null
  const env = (await res.json()) as Envelope<{ accessToken: string; refreshToken: string }>
  if (!env.data) return null
  const next = { accessToken: env.data.accessToken, refreshToken: env.data.refreshToken }
  setTokens(next)
  return next
}

/* ─── Core fetch helpers ───────────────────────────────────────────────── */

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const tokens = getTokens()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (tokens) headers['Authorization'] = `Bearer ${tokens.accessToken}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401 && tokens) {
    const refreshed = await refreshTokens()
    if (!refreshed) {
      window.location.href = '/login'
      throw new Error('Session expired')
    }
    headers['Authorization'] = `Bearer ${refreshed.accessToken}`
    const retry = await fetch(`${BASE}${path}`, { ...options, headers })
    const env = (await retry.json()) as Envelope<T>
    return unwrap(env)
  }

  const env = (await res.json().catch(() => ({ data: null, error: { code: 'NETWORK', message: 'Invalid response' } }))) as Envelope<T>
  return unwrap(env)
}

export async function apiFormFetch<T>(
  path: string,
  body: FormData,
): Promise<T> {
  const tokens = getTokens()
  const headers: Record<string, string> = {}
  if (tokens) headers['Authorization'] = `Bearer ${tokens.accessToken}`

  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body })
  if (res.status === 401 && tokens) {
    const refreshed = await refreshTokens()
    if (!refreshed) { window.location.href = '/login'; throw new Error('Session expired') }
    headers['Authorization'] = `Bearer ${refreshed.accessToken}`
    const retry = await fetch(`${BASE}${path}`, { method: 'POST', headers, body })
    const env = (await retry.json()) as Envelope<T>
    return unwrap(env)
  }
  const env = (await res.json().catch(() => ({ data: null, error: { code: 'NETWORK', message: 'Invalid response' } }))) as Envelope<T>
  return unwrap(env)
}

/* ─── apiStream — minimal "stream" wrapper. The v3 backend currently returns
 *     full replies non-streaming; we emit the entire body as one chunk so the
 *     Tutor UI's onChunk callback fires once with the full text. Real
 *     server-sent-events / chunked streaming lands when Groq is wired with the
 *     streaming endpoint. ─────────────────────────────────────────────── */

export async function apiStream(
  path: string,
  body: unknown,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const result = await apiFetch<{ reply?: string }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  onChunk(result.reply ?? '');
}

/* ─── Auth adapters — backend returns flat {accessToken, refreshToken, user, ...};
 *     portals expect {tokens, user}. Convert here. ─────────────────────── */

interface FlatAuthResponse {
  accessToken: string
  refreshToken: string
  user: User
  // Optional fields the backend may include (inviteCode for institution signup, etc.)
  inviteCode?: string
  context?: Record<string, unknown>
  institutionName?: string
}

export async function postLogin(body: { email: string; password: string }): Promise<{ tokens: AuthTokens; user: User }> {
  const flat = await apiFetch<FlatAuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    tokens: { accessToken: flat.accessToken, refreshToken: flat.refreshToken },
    user: flat.user,
  }
}

// v3.1 — `type` dropped. Server defaults to 'higher-ed'.
export async function postSignupInstitution(body: {
  institutionName: string; email: string; password: string; name: string;
}): Promise<{ tokens: AuthTokens; user: User; inviteCode: string }> {
  const flat = await apiFetch<FlatAuthResponse>('/api/auth/signup/institution', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    tokens: { accessToken: flat.accessToken, refreshToken: flat.refreshToken },
    user: flat.user,
    inviteCode: flat.inviteCode ?? '',
  }
}

// v3.1 — `archetype` dropped (server derives from JD).
export async function postSignupEmployer(body: {
  employerName: string; email: string; password: string; name: string;
}): Promise<{ tokens: AuthTokens; user: User }> {
  const flat = await apiFetch<FlatAuthResponse>('/api/auth/signup/employer', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    tokens: { accessToken: flat.accessToken, refreshToken: flat.refreshToken },
    user: flat.user,
  }
}

export async function postSignupLearner(body: {
  inviteCode: string; email: string; password: string; name: string;
}): Promise<{ tokens: AuthTokens; user: User; institutionName: string }> {
  const flat = await apiFetch<FlatAuthResponse>('/api/auth/signup/learner', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    tokens: { accessToken: flat.accessToken, refreshToken: flat.refreshToken },
    user: flat.user,
    institutionName: flat.institutionName ?? '',
  }
}
