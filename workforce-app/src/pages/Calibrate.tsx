/**
 * Calibrate — BC 99-101
 *
 * Per-role calibration page. Shows 8 cluster sliders, peer benchmark P50,
 * deviation badges, matched-institutions count, and the Institute Opportunity Map.
 *
 * Route: /roles/:id/calibrate
 */
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import clsx from 'clsx'

const CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const
type ClusterCode = (typeof CLUSTERS)[number]

interface Deviation {
  clusterCode: ClusterCode
  yourTarget: number
  p50: number
  deviationSigma: number
  badge: 'above' | 'below' | 'aligned'
}

interface CalibrateData {
  role: { id: string; title: string; careerTrackId: string; careerTrackName: string }
  clusterTargets: Record<ClusterCode, number>
  peerP50: Record<ClusterCode, number>
  deviations: Deviation[]
  matchedInstitutesCount: number
  peerP50Source: string
}

interface Institute {
  institutionId: string
  name: string
  cohortSize: number
  fitScore: number
  nirfRank: number | null
  partnershipStatus: 'None' | 'Pending' | 'Active' | 'Declined'
}

function badgeCls(badge: 'above' | 'below' | 'aligned') {
  if (badge === 'above') return 'bg-amber-100 text-amber-800 border border-amber-200'
  if (badge === 'below') return 'bg-amber-100 text-amber-800 border border-amber-200'
  return 'bg-green-100 text-green-800 border border-green-200'
}

function badgeLabel(badge: 'above' | 'below' | 'aligned') {
  if (badge === 'above') return '▲ above median'
  if (badge === 'below') return '▼ below median'
  return '✓ aligned'
}

function partnershipBadge(status: Institute['partnershipStatus']) {
  if (status === 'Active') return 'bg-green-100 text-green-800'
  if (status === 'Pending') return 'bg-amber-100 text-amber-800'
  if (status === 'Declined') return 'bg-red-100 text-red-700'
  return 'bg-cloud text-slate'
}

export default function Calibrate() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  // Local slider state — initialised from server data
  const [sliders, setSliders] = useState<Record<ClusterCode, number> | null>(null)
  const [requestingPartnership, setRequestingPartnership] = useState<string | null>(null)

  // Fetch calibrate data — short staleTime so slider changes re-query quickly
  const calibrateQ = useQuery<CalibrateData>({
    queryKey: ['calibrate', id],
    queryFn: () => apiFetch(`/api/v1/workforce/roles/${id!}/calibrate`),
    staleTime: 200,
  } as any) as { data: CalibrateData | undefined; isLoading: boolean; isFetching: boolean; refetch: () => void }

  // Initialise sliders once we have server data
  useEffect(() => {
    if (calibrateQ.data && !sliders) {
      const targets = calibrateQ.data.clusterTargets
      const initial: Record<string, number> = {}
      for (const c of CLUSTERS) initial[c] = targets[c] ?? 60
      setSliders(initial as Record<ClusterCode, number>)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrateQ.data?.role?.id])

  // Institute opportunity map
  const institutesQ = useQuery<{ institutes: Institute[] }>({
    queryKey: ['institutes', id],
    queryFn: () => apiFetch(`/api/v1/workforce/roles/${id!}/institutes`),
    staleTime: 30_000,
  } as any) as { data: { institutes: Institute[] } | undefined; isLoading: boolean; isFetching: boolean }

  // PATCH targets when slider settles (debounced via slider commit)
  const patchMutation = useMutation<unknown, Error, Record<ClusterCode, number>>({
    mutationFn: (targets) =>
      apiFetch(`/api/v1/workforce/roles/${id!}/targets`, {
        method: 'PATCH',
        body: JSON.stringify(targets),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calibrate', id] })
      qc.invalidateQueries({ queryKey: ['institutes', id] })
    },
    onError: (e) => showToast(e.message),
  })

  const handleSliderChange = useCallback(
    (cluster: ClusterCode, value: number) => {
      setSliders((prev) => {
        if (!prev) return prev
        return { ...prev, [cluster]: value }
      })
    },
    [],
  )

  const handleSliderCommit = useCallback(
    (cluster: ClusterCode, value: number) => {
      setSliders((prev) => {
        if (!prev) return prev
        const next = { ...prev, [cluster]: value }
        patchMutation.mutate(next)
        return next
      })
    },
    [patchMutation],
  )

  // Request partnership
  async function requestPartnership(institutionId: string) {
    setRequestingPartnership(institutionId)
    try {
      await apiFetch(`/api/v1/workforce/institutes/${institutionId}/partnership`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      showToast('Partnership request sent', 'success')
      qc.invalidateQueries({ queryKey: ['institutes', id] })
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRequestingPartnership(null)
    }
  }

  const cal = calibrateQ.data
  const institutes = institutesQ.data?.institutes ?? []

  const effectiveTargets = sliders ?? (cal ? (cal.clusterTargets as Record<ClusterCode, number>) : null)

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <button onClick={() => navigate('/roles')} className="text-slate hover:text-navy transition-colors">
          ← Career Tracks
        </button>
        <span className="text-slate">/</span>
        {cal && (
          <>
            <button
              onClick={() => navigate(`/roles/${id}`)}
              className="text-slate hover:text-navy transition-colors"
            >
              {cal.role.title}
            </button>
            <span className="text-slate">/</span>
          </>
        )}
        <span className="font-semibold text-navy">Calibrate</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy mb-1">
            {cal ? cal.role.title : 'Loading…'}
          </h1>
          <p className="text-xs text-slate">
            {cal ? `Career Track: ${cal.role.careerTrackName}` : ''}
          </p>
        </div>
        {cal && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] font-semibold text-slate uppercase tracking-wide">Matched Institutions</div>
              <div className="text-2xl font-bold text-accent">{cal.matchedInstitutesCount}</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* ── Cluster Sliders ── */}
        <div className="bg-white rounded-md border border-rule shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-navy">Cluster Targets</h2>
            {patchMutation.isPending && (
              <span className="text-[10px] text-slate animate-pulse">Saving…</span>
            )}
          </div>
          {!effectiveTargets ? (
            <div className="text-slate text-sm py-4">Loading targets…</div>
          ) : (
            <div className="flex flex-col gap-4">
              {CLUSTERS.map((c) => {
                const val = effectiveTargets[c] ?? 60
                return (
                  <div key={c} className="flex items-center gap-3">
                    <span className="text-[11px] font-bold text-slate w-6 flex-shrink-0">{c}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={val}
                      onChange={(e) => handleSliderChange(c, Number(e.target.value))}
                      onMouseUp={(e) => handleSliderCommit(c, Number((e.target as HTMLInputElement).value))}
                      onTouchEnd={(e) => handleSliderCommit(c, Number((e.target as HTMLInputElement).value))}
                      className="flex-1 accent-accent cursor-pointer"
                    />
                    <span className="text-[12px] font-bold text-ink w-7 text-right flex-shrink-0 tabular-nums">
                      {val}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Peer Benchmark ── */}
        <div className="bg-white rounded-md border border-rule shadow-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-navy">Peer Benchmark</h2>
            {cal && (
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-cloud text-slate border border-rule uppercase tracking-wide">
                {cal.peerP50Source === 'live-aggregate' ? 'Live aggregate' : 'Market baseline'}
              </span>
            )}
          </div>
          {calibrateQ.isLoading ? (
            <div className="text-slate text-sm py-4">Loading…</div>
          ) : cal ? (
            cal.deviations.every((d) => d.yourTarget === 0) ? (
              <div className="py-6 text-center">
                <div className="text-[13px] font-semibold text-navy mb-1">No targets set yet</div>
                <p className="text-xs text-slate max-w-xs mx-auto">
                  Use the cluster sliders on the left to define your hiring bar — we'll show how you compare to peer employers in real time.
                </p>
              </div>
            ) : (
            <div className="flex flex-col gap-3">
              {cal.deviations.map((d) => (
                <div key={d.clusterCode} className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate w-6 flex-shrink-0">{d.clusterCode}</span>
                  <div className="flex-1 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[9px] text-slate mb-0.5">Your target</div>
                      <div className="text-[13px] font-bold text-navy tabular-nums">{d.yourTarget}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-slate mb-0.5">Market P50</div>
                      <div className="text-[13px] font-bold text-slate tabular-nums">{d.p50}</div>
                    </div>
                    <div className="flex items-center justify-center">
                      <span
                        className={clsx(
                          'text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap',
                          badgeCls(d.badge),
                        )}
                      >
                        {badgeLabel(d.badge)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )
          ) : (
            <div className="text-red-600 text-sm">Failed to load benchmark.</div>
          )}
        </div>
      </div>

      {/* ── Institute Opportunity Map ── */}
      <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-navy">Institute Opportunity Map</h2>
            <p className="text-xs text-slate mt-0.5">
              Institutions ranked by cohort fit for this role's cluster targets. Requires ≥5 learners per institution.
            </p>
          </div>
          {institutesQ.isFetching && (
            <span className="text-[10px] text-slate animate-pulse">Refreshing…</span>
          )}
        </div>

        {institutesQ.isLoading ? (
          <div className="px-5 py-8 text-slate text-sm">Loading institutions…</div>
        ) : institutes.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-sm font-semibold text-navy mb-1">No institutions qualify yet</div>
            <p className="text-xs text-slate max-w-sm mx-auto">
              Either no institution has ≥5 learners with competency scores, or no learners match your targets.
              Try lowering your cluster targets using the sliders above.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Institution', 'Cohort Size', 'Fit Score', 'NIRF Rank', 'Partnership', 'Action'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {institutes.map((inst) => (
                <tr key={inst.institutionId} className="border-b border-rule last:border-0 hover:bg-cloud/40">
                  <td className="px-4 py-3 font-medium text-navy">{inst.name}</td>
                  <td className="px-4 py-3 tabular-nums text-sm text-ink">{inst.cohortSize}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-cloud rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full rounded-full',
                            inst.fitScore >= 70
                              ? 'bg-green-600'
                              : inst.fitScore >= 50
                              ? 'bg-amber-500'
                              : 'bg-red-500',
                          )}
                          style={{ width: `${inst.fitScore}%` }}
                        />
                      </div>
                      <span
                        className={clsx(
                          'text-[12px] font-bold tabular-nums',
                          inst.fitScore >= 70
                            ? 'text-green-700'
                            : inst.fitScore >= 50
                            ? 'text-amber-600'
                            : 'text-red-600',
                        )}
                      >
                        {inst.fitScore}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink tabular-nums">
                    {inst.nirfRank ? `#${inst.nirfRank}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        partnershipBadge(inst.partnershipStatus),
                      )}
                    >
                      {inst.partnershipStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {inst.partnershipStatus === 'None' ? (
                      <button
                        disabled={requestingPartnership === inst.institutionId}
                        onClick={() => requestPartnership(inst.institutionId)}
                        className="text-[11px] font-semibold px-3 py-1 rounded bg-accent text-white hover:bg-accent-dark transition-colors disabled:opacity-60"
                      >
                        {requestingPartnership === inst.institutionId ? 'Sending…' : 'Request Partnership'}
                      </button>
                    ) : inst.partnershipStatus === 'Active' ? (
                      <button
                        onClick={() => navigate(`/roles/${id}/discovery`)}
                        className="text-[11px] font-semibold px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
                      >
                        View Candidates →
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate">
                        {inst.partnershipStatus === 'Pending' ? 'Awaiting response' : 'Declined'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Link to Discovery Panel */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => navigate(`/roles/${id}/discovery`)}
          className="text-sm font-semibold px-4 py-2 rounded bg-accent text-white hover:bg-accent-dark transition-colors"
        >
          Open Candidate Discovery →
        </button>
      </div>
    </div>
  )
}
