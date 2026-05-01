/**
 * BC 105 + BC 106 + BC 108 — Cohort Gap Drill-Down
 *
 * Page structure:
 *   1. 8-cluster gap heatmap (BC 105)
 *      Red >15 gap, Amber 5–15, Green ≤5
 *      Clicking a cell scrolls to / highlights the learner list
 *   2. Paginated learner table (BC 106)
 *      Each row shows the learner's cluster scores + band + confidence
 *      Clicking a row opens the learner radar modal (BC 108)
 *   3. Radar modal — LearnerClusterRadarVsCohortMedian (BC 108)
 */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { LearnerClusterRadarVsCohortMedian } from '../viz/LearnerClusterRadarVsCohortMedian'
import type { CohortGap, CohortDrillResult, LearnerRadar, ClusterRecord } from '../types'

const CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const
const CLUSTER_NAMES: Record<string, string> = {
  C1: 'Core Tech', C2: 'Problem Solving', C3: 'Execution', C4: 'Systems',
  C5: 'Communication', C6: 'Domain', C7: 'Ownership', C8: 'Agility',
}

function gapColor(gap: number | null): string {
  if (gap === null) return 'bg-slate-100 text-slate-400'
  if (gap > 15) return 'bg-red-100 border-red-400 text-red-700'
  if (gap > 5)  return 'bg-amber-50 border-amber-400 text-amber-700'
  return 'bg-green-50 border-green-400 text-green-700'
}

function bandBadgeColor(band: string): string {
  if (band === 'Advanced')   return 'bg-green-100 text-green-700'
  if (band === 'Proficient') return 'bg-blue-100 text-blue-700'
  if (band === 'Developing') return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

export default function CohortGapDrillDown() {
  const { id: careerTrackId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [focusCluster, setFocusCluster] = useState<string | null>(null)
  const [radarLearnerId, setRadarLearnerId] = useState<string | null>(null)

  const gapQ = useQuery<CohortGap>({
    queryKey: ['cohort-gap', careerTrackId],
    queryFn: () => apiFetch(`/api/v1/campus/career-tracks/${careerTrackId}/gap`),
    enabled: !!careerTrackId,
  } as any)

  const cohortQ = useQuery<CohortDrillResult>({
    queryKey: ['cohort-drill', careerTrackId, page],
    queryFn: () => apiFetch(`/api/v1/campus/career-tracks/${careerTrackId}/cohort?page=${page}&pageSize=25`),
    enabled: !!careerTrackId,
  } as any)

  const radarQ = useQuery<LearnerRadar>({
    queryKey: ['learner-radar', radarLearnerId],
    queryFn: () => apiFetch(`/api/v1/campus/learners/${radarLearnerId}/radar`),
    enabled: !!radarLearnerId,
  } as any)

  const gap = gapQ.data
  const cohort = cohortQ.data

  const totalPages = cohort ? Math.ceil(cohort.total / cohort.pageSize) : 1

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => navigate(-1)}
          className="text-xs text-slate hover:text-navy"
        >
          ← Back
        </button>
        <h1 className="text-[18px] font-bold text-navy">Cohort Gap Intelligence</h1>
        {gap && (
          <span className="text-xs text-slate">
            {gap.learnerCount} learner{gap.learnerCount === 1 ? '' : 's'} enrolled
          </span>
        )}
      </div>

      {/* BC 105 — Cluster Gap Heatmap */}
      <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden mb-5">
        <div className="px-4 py-3.5 border-b border-rule">
          <span className="text-[12.5px] font-semibold text-navy">Cluster Gap Heatmap</span>
          <span className="text-xs text-slate ml-2">
            Cohort median vs employer P50 — click a cluster to highlight that column in the learner table
          </span>
        </div>
        {gapQ.isLoading && (
          <div className="p-6 text-center text-slate text-sm">Loading gap data…</div>
        )}
        {gap && (
          <div className="p-5">
            {/* k-anon notice */}
            {gap.cohortMedian === null && (
              <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                Fewer than 5 learners enrolled — cohort median is suppressed to protect learner privacy (k-anonymity rule).
              </div>
            )}
            <div className="grid grid-cols-8 gap-2">
              {CLUSTERS.map(c => {
                const gapVal = gap.gap[c] ?? null
                const median = gap.cohortMedian ? (gap.cohortMedian as ClusterRecord)[c] : null
                const p50 = (gap.employerP50 as ClusterRecord)[c]
                const inFlight = gap.inFlightAssignments?.[c] ?? 0
                const isActive = focusCluster === c
                return (
                  <button
                    key={c}
                    onClick={() => setFocusCluster(isActive ? null : c)}
                    className={`
                      p-3 rounded border-2 text-center cursor-pointer transition-all
                      ${gapColor(gapVal)}
                      ${isActive ? 'ring-2 ring-offset-1 ring-accent' : ''}
                    `}
                  >
                    <div className="text-[11px] font-bold mb-1">{c}</div>
                    <div className="text-[10px] font-medium mb-2">{CLUSTER_NAMES[c]}</div>
                    <div className="text-base font-bold leading-none mb-1">
                      {gapVal !== null ? (gapVal > 0 ? `+${gapVal.toFixed(1)}` : gapVal.toFixed(1)) : '—'}
                    </div>
                    <div className="text-[9px] opacity-70">
                      {median !== null ? `Cohort: ${median.toFixed(0)}` : 'Cohort: —'}
                    </div>
                    <div className="text-[9px] opacity-70">Bar: {p50.toFixed(0)}</div>
                    {inFlight > 0 && (
                      <div className="mt-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                        {inFlight} in-flight
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            {/* Legend */}
            <div className="flex gap-4 mt-3 flex-wrap">
              {[
                { cls: 'bg-green-50 border-green-400', label: 'On-track (gap ≤5)' },
                { cls: 'bg-amber-50 border-amber-400',  label: 'Attention (gap 5–15)' },
                { cls: 'bg-red-100 border-red-400',     label: 'Critical (gap >15)' },
              ].map(({ cls, label }) => (
                <div key={label} className="flex items-center gap-1.5 text-[10px] text-slate">
                  <div className={`w-3 h-3 rounded border-2 ${cls}`} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* BC 106 — Learner Drill-Down Table */}
      <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden mb-5">
        <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-navy">
            Learner Detail
            {focusCluster && (
              <span className="ml-2 text-xs font-normal text-accent">Filtered: {focusCluster} highlighted</span>
            )}
          </span>
          {cohort && (
            <span className="text-xs text-slate">{cohort.total} learner{cohort.total === 1 ? '' : 's'}</span>
          )}
        </div>
        {cohortQ.isLoading && (
          <div className="p-6 text-center text-slate text-sm">Loading learner data…</div>
        )}
        {cohort && cohort.learners.length === 0 && (
          <div className="p-8 text-center text-slate text-sm">No learners enrolled in this career track yet.</div>
        )}
        {cohort && cohort.learners.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide bg-cloud border-b border-rule sticky left-0">
                    Learner
                  </th>
                  {CLUSTERS.map(c => (
                    <th
                      key={c}
                      className={`px-2 py-2 text-center text-[9.5px] font-semibold uppercase tracking-wide border-b border-rule whitespace-nowrap
                        ${focusCluster === c ? 'bg-accent/10 text-accent' : 'bg-cloud text-slate'}`}
                    >
                      {c}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide bg-cloud border-b border-rule">
                    Band
                  </th>
                  <th className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide bg-cloud border-b border-rule">
                    Confidence
                  </th>
                  <th className="px-4 py-2 bg-cloud border-b border-rule" />
                </tr>
              </thead>
              <tbody>
                {cohort.learners.map(l => (
                  <tr
                    key={l.learnerId}
                    className="border-b border-rule last:border-0 hover:bg-cloud/40 cursor-pointer"
                    onClick={() => setRadarLearnerId(l.learnerId)}
                  >
                    <td className="px-4 py-3 sticky left-0 bg-white">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                          {l.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium text-navy text-xs">{l.name}</span>
                      </div>
                    </td>
                    {CLUSTERS.map(c => {
                      const score = (l.clusterScores as ClusterRecord)[c]
                      const gapForCluster = gap?.gap[c] ?? null
                      return (
                        <td
                          key={c}
                          className={`px-2 py-3 text-center text-xs font-semibold
                            ${focusCluster === c ? 'bg-accent/5' : ''}
                          `}
                        >
                          <span className={
                            score === 0 ? 'text-slate/50' :
                            gapForCluster !== null && score < (gap?.employerP50 as ClusterRecord)[c] - 5
                              ? 'text-red-600' : 'text-ink'
                          }>
                            {score > 0 ? score.toFixed(0) : '—'}
                          </span>
                        </td>
                      )
                    })}
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${bandBadgeColor(l.band)}`}>
                        {l.band}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate">
                      {(l.signalConfidence * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="text-xs font-medium text-accent hover:underline"
                        onClick={e => { e.stopPropagation(); setRadarLearnerId(l.learnerId) }}
                      >
                        Radar →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {cohort && totalPages > 1 && (
          <div className="px-4 py-3 border-t border-rule flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-40 disabled:no-underline"
            >
              ← Previous
            </button>
            <span className="text-xs text-slate">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-40 disabled:no-underline"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* BC 108 — Radar Modal */}
      {radarLearnerId && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setRadarLearnerId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-navy">Learner Competency Radar</h3>
              <button
                onClick={() => setRadarLearnerId(null)}
                className="text-slate hover:text-navy text-lg leading-none"
              >
                ✕
              </button>
            </div>
            {radarQ.isLoading && (
              <div className="text-center py-8 text-slate text-sm">Loading radar…</div>
            )}
            {radarQ.data && (() => {
              const r = radarQ.data
              const learnerName = cohort?.learners.find(l => l.learnerId === radarLearnerId)?.name ?? 'Learner'
              const seriesData: [
                { data: number[]; label: string },
                { data: number[]; label: string }
              ] = [
                {
                  data: CLUSTERS.map(c => (r.learner as ClusterRecord)[c]),
                  label: learnerName,
                },
                {
                  data: r.cohortMedian
                    ? CLUSTERS.map(c => (r.cohortMedian as ClusterRecord)[c])
                    : CLUSTERS.map(() => 0),
                  label: r.cohortMedian ? 'Cohort median' : 'Cohort median (suppressed)',
                },
              ]
              return (
                <div>
                  {r.cohortMedian === null && (
                    <p className="text-[10px] text-amber-600 mb-3">
                      Cohort median suppressed — fewer than 5 learners in track.
                    </p>
                  )}
                  <LearnerClusterRadarVsCohortMedian data={seriesData} size={340} />
                  <div className="mt-4 pt-4 border-t border-rule">
                    <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Employer Bar (P50)</div>
                    <div className="grid grid-cols-8 gap-1">
                      {CLUSTERS.map(c => (
                        <div key={c} className="text-center">
                          <div className="text-[9px] text-slate">{c}</div>
                          <div className="text-[11px] font-bold text-navy">{(r.employerBar as ClusterRecord)[c].toFixed(0)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
