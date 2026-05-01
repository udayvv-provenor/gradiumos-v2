import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { OpportunitiesV2Response, OpportunityV2 } from '../types'
import clsx from 'clsx'

/**
 * Phase C intelligence surfaces — BC 81-85.
 *
 * BC 81 — Opportunities list sorted by matchScore desc, connected to /api/v1/talent/me/opportunities
 * BC 82 — Filter bar: minMatch slider + careerTrack dropdown + city dropdown (URL params)
 * BC 83 — Near-miss badge: "Near miss — N points away on Cx"
 * BC 84 — Near-miss CTA link to pathway / Learn cluster
 * BC 85 — "New match — signal improved" badge when newMatch=true
 */

const POPULAR_CITIES = [
  '', // all cities
  'Bangalore',
  'Hyderabad',
  'Pune',
  'Chennai',
  'Delhi NCR',
  'Mumbai',
  'Remote India',
]

// ─── Near-miss badge ──────────────────────────────────────────────────────────

function NearMissBadge({ opp }: { opp: OpportunityV2 }) {
  if (!opp.nearMiss || !opp.nearMissDetails) return null
  const gaps = opp.nearMissDetails.gaps
  const label = gaps
    .map((g) => `${g.delta} pts on ${g.clusterCode}`)
    .join(', ')
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      Near miss — {label} away
    </span>
  )
}

// ─── New match badge (BC 85) ──────────────────────────────────────────────────

function NewMatchBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
      New match — signal improved
    </span>
  )
}

// ─── Match score colour ───────────────────────────────────────────────────────

function matchColor(score: number) {
  if (score >= 80) return 'text-green-700'
  if (score >= 65) return 'text-amber-600'
  return 'text-red-600'
}

function matchBarColor(score: number) {
  if (score >= 80) return 'bg-green-700'
  if (score >= 65) return 'bg-amber-500'
  return 'bg-red-600'
}

// ─── Component ───────────────────────────────────────────────────────────────

// ─── Apply button per opportunity card ───────────────────────────────────────

function ApplyButton({ roleId, alreadyApplied }: { roleId: string; alreadyApplied: boolean }) {
  const queryClient = useQueryClient()
  const [applied, setApplied] = useState(alreadyApplied)

  const apply = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string }>(`/api/v1/talent/me/opportunities/${roleId}/apply`, {
        method: 'POST',
      }),
    onSuccess: () => {
      setApplied(true)
      showToast('Application submitted!')
      void queryClient.invalidateQueries({ queryKey: ['v1-my-applications'] })
    },
    onError: (e: Error) => showToast(e.message),
  })

  if (applied) {
    return (
      <span className="px-4 py-1.5 bg-green-50 border border-green-200 text-green-700 text-xs font-semibold rounded cursor-default">
        Applied
      </span>
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); apply.mutate() }}
      disabled={apply.isPending}
      className="px-4 py-1.5 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {apply.isPending ? 'Applying…' : 'Apply →'}
    </button>
  )
}

export default function Opportunities() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // BC 82 — filter state kept in URL params so sharing/refresh preserves filters
  const [minMatch, setMinMatch] = useState<number>(() =>
    Number(searchParams.get('minMatch') ?? '0'),
  )
  const [careerTrackId, setCareerTrackId] = useState<string>(
    searchParams.get('careerTrackId') ?? '',
  )
  const [city, setCity] = useState<string>(searchParams.get('city') ?? '')

  // Sync filter changes into URL params
  useEffect(() => {
    const params: Record<string, string> = {}
    if (minMatch > 0) params.minMatch = String(minMatch)
    if (careerTrackId) params.careerTrackId = careerTrackId
    if (city) params.city = city
    setSearchParams(params, { replace: true })
  }, [minMatch, careerTrackId, city, setSearchParams])

  // Build query string for API call
  const qs = new URLSearchParams()
  if (minMatch > 0) qs.set('minMatch', String(minMatch))
  if (careerTrackId) qs.set('careerTrackId', careerTrackId)
  if (city) qs.set('city', city)

  const { data: oppData, isLoading } = useQuery<OpportunitiesV2Response>({
    queryKey: ['v1-opportunities', minMatch, careerTrackId, city],
    queryFn: () =>
      apiFetch<OpportunitiesV2Response>(`/api/v1/talent/me/opportunities${qs.toString() ? `?${qs.toString()}` : ''}`),
  } as Parameters<typeof useQuery<OpportunitiesV2Response>>[0])

  // Fetch existing applications to pre-populate applied state
  const { data: appsData } = useQuery<{ applications: { roleId: string }[] }>({
    queryKey: ['v1-my-applications'],
    queryFn: () => apiFetch<{ applications: { roleId: string }[] }>('/api/v1/talent/me/applications'),
  } as Parameters<typeof useQuery<{ applications: { roleId: string }[] }>>[0])
  const appliedRoleIds = new Set((appsData?.applications ?? []).map((a) => a.roleId))

  const opps: OpportunityV2[] = (oppData as OpportunitiesV2Response | undefined)?.opportunities ?? []

  // Collect distinct careerTrack codes from results for the dropdown
  const trackOptions = Array.from(new Set(opps.map((o) => o.careerTrackCode))).sort()

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">Opportunities</h1>
        <p className="text-xs text-slate mt-0.5">
          Platform roles matched against your GradiumOS competency signal — sorted by match score.
          Near-miss roles show you exactly what to close.
        </p>
      </div>

      {/* ── BC 82 — Filter bar (BC 173: stacks vertically on mobile) ─────────── */}
      <div className="bg-white rounded-md border border-rule shadow-card px-4 sm:px-5 py-3.5 mb-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 flex-wrap">
        {/* Min match slider */}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[200px]">
          <label className="text-[10px] text-slate uppercase tracking-wider font-bold whitespace-nowrap">
            Min match
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minMatch}
            onChange={(e) => setMinMatch(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-[10px] font-bold text-navy w-8 text-right">{minMatch}%</span>
        </div>

        {/* Career track dropdown */}
        {trackOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-slate uppercase tracking-wider font-bold whitespace-nowrap">
              Track
            </label>
            <select
              value={careerTrackId}
              onChange={(e) => setCareerTrackId(e.target.value)}
              className="text-xs px-2 py-1.5 border border-rule rounded bg-white focus:outline-none focus:border-accent"
            >
              <option value="">All tracks</option>
              {trackOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* City dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-slate uppercase tracking-wider font-bold whitespace-nowrap">
            City
          </label>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="text-xs px-2 py-1.5 border border-rule rounded bg-white focus:outline-none focus:border-accent"
          >
            {POPULAR_CITIES.map((c) => (
              <option key={c} value={c}>
                {c || 'All cities'}
              </option>
            ))}
          </select>
        </div>

        {/* Reset */}
        {(minMatch > 0 || careerTrackId || city) && (
          <button
            onClick={() => {
              setMinMatch(0)
              setCareerTrackId('')
              setCity('')
            }}
            className="text-[10px] text-slate hover:text-accent underline ml-auto"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* ── Loading / empty states ───────────────────────────────────────────── */}
      {isLoading && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Matching opportunities against your signal…
        </div>
      )}

      {!isLoading && opps.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">⚡</div>
          <div className="text-sm font-semibold text-navy mb-1">No opportunities match your current filters</div>
          <p className="text-xs text-slate max-w-md mx-auto">
            Try lowering the minimum match threshold, removing the city filter, or completing more
            assessments to raise your competency signal.
          </p>
          <button
            onClick={() => { setMinMatch(0); setCareerTrackId(''); setCity('') }}
            className="mt-4 text-xs font-semibold text-accent hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── BC 81 — Opportunity cards sorted by matchScore desc ─────────────── */}
      {opps.length > 0 && (
        <div className="flex flex-col gap-3">
          {opps.map((opp) => (
            <div
              key={opp.roleId}
              className={clsx(
                'bg-white rounded-md border shadow-card p-5 transition-all',
                opp.nearMiss
                  ? 'border-amber-200 hover:border-amber-400'
                  : 'border-rule hover:border-accent/30 hover:shadow-hover',
              )}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left — role info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <h3 className="text-sm font-bold text-navy truncate max-w-[480px]">
                      {opp.title}
                    </h3>

                    {/* BC 85 — new match badge */}
                    {opp.newMatch && <NewMatchBadge />}

                    {/* BC 83 — near-miss badge */}
                    <NearMissBadge opp={opp} />
                  </div>

                  <div className="text-xs text-slate mb-1">
                    {opp.employerName}
                    {opp.city && <span> · {opp.city}</span>}
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-cloud text-slate font-medium">
                      {opp.careerTrackCode}
                    </span>
                  </div>

                  {/* BC 83 — near-miss detail: per-cluster deltas */}
                  {opp.nearMiss && opp.nearMissDetails && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {opp.nearMissDetails.gaps.map((g) => (
                        <span
                          key={g.clusterCode}
                          className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-800"
                        >
                          {g.clusterCode}: {g.delta} pts to bar
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right — match score + CTAs */}
                <div className="flex flex-col items-end gap-3 flex-shrink-0">
                  <div className="text-right">
                    <div className={clsx('text-2xl font-bold leading-none', matchColor(opp.matchScore))}>
                      {opp.matchScore}%
                    </div>
                    <div className="text-[10px] text-slate mt-0.5">match</div>
                  </div>

                  {/* BC 116 — Apply button */}
                  <ApplyButton roleId={opp.roleId} alreadyApplied={appliedRoleIds.has(opp.roleId)} />

                  {/* BC 84 — near-miss CTA: link to Learn cluster to close the gap */}
                  {opp.nearMiss && opp.nearMissPathway && (
                    <button
                      onClick={() => navigate(`/learn#${opp.nearMissPathway!.clusterCode}`)}
                      className="px-4 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded hover:bg-amber-700 transition-colors"
                    >
                      Close gap →
                    </button>
                  )}
                </div>
              </div>

              {/* Match bar */}
              <div className="mt-3 h-1.5 bg-cloud rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all duration-700',
                    matchBarColor(opp.matchScore),
                  )}
                  style={{ width: `${opp.matchScore}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
