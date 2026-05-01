/**
 * Discovery — BC 102-103
 *
 * Candidate discovery panel for a role. Shows ranked candidates with
 * matchScore, band, and cluster profiles. Non-consenting learners get
 * anonymised profiles with "Request contact" placeholder.
 *
 * Route: /roles/:id/discovery
 * Filter state in URL params: ?page=&minMatch=&city=&careerTrackId=
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import clsx from 'clsx'

const CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const

interface Candidate {
  learnerId: string
  band: 'Above' | 'Near' | 'Below'
  clusterProfile: Record<string, number | string>
  matchScore: number
  hasConsent: boolean
}

interface DiscoveryResponse {
  candidates: Candidate[]
  total: number
  page: number
  pageSize: number
}

function bandCls(band: 'Above' | 'Near' | 'Below') {
  if (band === 'Above') return 'bg-green-100 text-green-800'
  if (band === 'Near') return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-700'
}

function matchScoreColor(score: number) {
  if (score >= 80) return 'text-green-700'
  if (score >= 65) return 'text-amber-600'
  return 'text-red-600'
}

function ClusterChip({ code, value }: { code: string; value: number | string }) {
  if (typeof value === 'string') {
    // Anonymised
    const cls =
      value === 'High'
        ? 'bg-green-100 text-green-800'
        : value === 'Mid'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-cloud text-slate'
    return (
      <span className={clsx('text-[9px] font-semibold px-1.5 py-0.5 rounded', cls)}>
        {code}: {value}
      </span>
    )
  }
  const numVal = value as number
  const cls =
    numVal >= 70
      ? 'bg-green-100 text-green-800'
      : numVal >= 40
      ? 'bg-amber-100 text-amber-700'
      : 'bg-red-100 text-red-700'
  return (
    <span className={clsx('text-[9px] font-semibold px-1.5 py-0.5 rounded tabular-nums', cls)}>
      {code}: {numVal}
    </span>
  )
}

export default function Discovery() {
  const { id: roleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1
  const minMatch = searchParams.get('minMatch') ?? '0'
  const city = searchParams.get('city') ?? ''
  const careerTrackId = searchParams.get('careerTrackId') ?? ''

  // Local filter inputs (committed on Apply)
  const [localMinMatch, setLocalMinMatch] = useState(minMatch)
  const [localCity, setLocalCity] = useState(city)
  const [localCareerTrack, setLocalCareerTrack] = useState(careerTrackId)

  // Sync local state when searchParams change externally
  useEffect(() => {
    setLocalMinMatch(searchParams.get('minMatch') ?? '0')
    setLocalCity(searchParams.get('city') ?? '')
    setLocalCareerTrack(searchParams.get('careerTrackId') ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  function applyFilters() {
    const next = new URLSearchParams()
    next.set('page', '1')
    if (localMinMatch && localMinMatch !== '0') next.set('minMatch', localMinMatch)
    if (localCity) next.set('city', localCity)
    if (localCareerTrack) next.set('careerTrackId', localCareerTrack)
    setSearchParams(next)
  }

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  // Build query string for API
  const queryString = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(minMatch && minMatch !== '0' ? { minMatch } : {}),
    ...(city ? { city } : {}),
    ...(careerTrackId ? { careerTrackId } : {}),
  }).toString()

  const discoveryQ = useQuery<DiscoveryResponse>({
    queryKey: ['discovery', roleId, queryString],
    queryFn: () => apiFetch(`/api/v1/workforce/roles/${roleId!}/discovery?${queryString}`),
    staleTime: 30_000,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0]) as { data: DiscoveryResponse | undefined; isLoading: boolean }

  const data = discoveryQ.data
  const candidates = data?.candidates ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 25))

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <button onClick={() => navigate('/roles')} className="text-slate hover:text-navy transition-colors">
          ← Career Tracks
        </button>
        <span className="text-slate">/</span>
        <button
          onClick={() => navigate(`/roles/${roleId}/calibrate`)}
          className="text-slate hover:text-navy transition-colors"
        >
          Calibrate
        </button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">Candidate Discovery</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy mb-1">Candidate Discovery</h1>
          <p className="text-xs text-slate">
            Learners ranked by match score against this role's cluster targets.
            Non-consenting learners show anonymised profiles.
          </p>
        </div>
        {data && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide">Total Matches</div>
            <div className="text-2xl font-bold text-accent tabular-nums">{total}</div>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-md border border-rule shadow-card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-slate uppercase tracking-wide mb-1">
              Min Match %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={localMinMatch}
              onChange={(e) => setLocalMinMatch(e.target.value)}
              className="w-20 text-sm px-2 py-1.5 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate uppercase tracking-wide mb-1">
              City
            </label>
            <input
              type="text"
              value={localCity}
              onChange={(e) => setLocalCity(e.target.value)}
              className="w-32 text-sm px-2 py-1.5 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
              placeholder="Any city"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate uppercase tracking-wide mb-1">
              Career Track ID
            </label>
            <input
              type="text"
              value={localCareerTrack}
              onChange={(e) => setLocalCareerTrack(e.target.value)}
              className="w-40 text-sm px-2 py-1.5 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
              placeholder="All tracks"
            />
          </div>
          <button
            onClick={applyFilters}
            className="px-4 py-1.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
          >
            Apply filters
          </button>
          {(minMatch !== '0' || city || careerTrackId) && (
            <button
              onClick={() => setSearchParams({})}
              className="px-3 py-1.5 bg-white text-slate text-sm font-medium rounded border border-rule hover:text-navy transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Candidate list */}
      {discoveryQ.isLoading ? (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Loading candidates…
        </div>
      ) : candidates.length === 0 ? (
        <div className="bg-white rounded-md border border-rule shadow-card p-10 text-center">
          <div className="text-sm font-semibold text-navy mb-1">No candidates found</div>
          <p className="text-xs text-slate max-w-md mx-auto">
            Try lowering the minimum match %, broadening the career track filter, or calibrating your cluster targets.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {candidates.map((c, i) => (
            <div
              key={`${c.learnerId}-${i}`}
              className="bg-white rounded-md border border-rule shadow-card p-4 flex items-start gap-4"
            >
              {/* Match score & band */}
              <div className="flex-shrink-0 text-center w-16">
                <div className={clsx('text-xl font-bold tabular-nums', matchScoreColor(c.matchScore))}>
                  {c.matchScore}%
                </div>
                <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full', bandCls(c.band))}>
                  {c.band}
                </span>
              </div>

              {/* Profile */}
              <div className="flex-1 min-w-0">
                {c.hasConsent ? (
                  <>
                    <div className="text-[11px] font-semibold text-navy mb-1.5">
                      Learner #{c.learnerId}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {CLUSTERS.map((code) => {
                        const val = c.clusterProfile[code]
                        if (val === undefined) return null
                        return <ClusterChip key={code} code={code} value={val} />
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[11px] font-semibold text-slate italic mb-1.5">
                      Anonymised profile
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {CLUSTERS.map((code) => {
                        const val = c.clusterProfile[code]
                        if (val === undefined) return null
                        return <ClusterChip key={code} code={code} value={val} />
                      })}
                    </div>
                    <button
                      disabled
                      className="text-[10px] font-semibold px-2.5 py-1 rounded border border-rule text-slate cursor-not-allowed"
                      title="Learner has not consented to opportunity matching"
                    >
                      Request contact (awaiting consent)
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between mt-5 px-1">
          <p className="text-xs text-slate">
            Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} candidates
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
              className="px-3 py-1.5 text-sm font-semibold rounded border border-rule text-ink hover:bg-cloud transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-sm text-slate tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
              className="px-3 py-1.5 text-sm font-semibold rounded border border-rule text-ink hover:bg-cloud transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
