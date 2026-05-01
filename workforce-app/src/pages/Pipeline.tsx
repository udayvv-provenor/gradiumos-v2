/**
 * BC 121 — /roles/:id/pipeline — Per-role application pipeline view
 *
 * Stage counts at top (clickable to filter list).
 * Candidate list with hashed learnerId, band, matchScore, status, appliedAt.
 * Status change dropdown for TA_LEAD (BC 117).
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { PipelineResponse, PipelineCandidate } from '../types'
import clsx from 'clsx'

const STAGES = ['Applied', 'Shortlisted', 'Interview', 'Offer', 'Accepted', 'Declined', 'Withdrawn'] as const
type Stage = typeof STAGES[number]

// Allowed transitions per stage (mirrors BC 118 state machine)
const ALLOWED_NEXT: Record<string, string[]> = {
  Applied:    ['Shortlisted', 'Declined', 'Withdrawn'],
  Shortlisted:['Interview',   'Declined', 'Withdrawn'],
  Interview:  ['Offer',       'Declined', 'Withdrawn'],
  Offer:      ['Accepted',    'Declined', 'Withdrawn'],
  Accepted:   [],
  Declined:   [],
  Withdrawn:  [],
}

const STAGE_CHIP: Record<string, string> = {
  Applied:    'bg-blue-50 text-blue-700 border-blue-200',
  Shortlisted:'bg-amber-50 text-amber-700 border-amber-200',
  Interview:  'bg-violet-50 text-violet-700 border-violet-200',
  Offer:      'bg-green-50 text-green-700 border-green-200',
  Accepted:   'bg-green-100 text-green-800 border-green-300',
  Declined:   'bg-red-50 text-red-700 border-red-200',
  Withdrawn:  'bg-slate-100 text-slate-500 border-slate-200',
}

const STAGE_COUNT_ACTIVE: Record<string, string> = {
  Applied:    'bg-blue-600 text-white',
  Shortlisted:'bg-amber-500 text-white',
  Interview:  'bg-violet-600 text-white',
  Offer:      'bg-green-600 text-white',
  Accepted:   'bg-green-700 text-white',
  Declined:   'bg-red-600 text-white',
  Withdrawn:  'bg-slate-500 text-white',
}

const BAND_CHIP: Record<string, string> = {
  Strong: 'bg-green-50 text-green-700 border-green-200',
  Good:   'bg-amber-50 text-amber-700 border-amber-200',
  Weak:   'bg-red-50 text-red-700 border-red-200',
}

// ─── Status change dropdown ───────────────────────────────────────────────────

function StatusChanger({ applicationId, currentStatus, roleId }: { applicationId: string; currentStatus: string; roleId: string }) {
  const queryClient = useQueryClient()
  const nextOptions = ALLOWED_NEXT[currentStatus] ?? []

  const move = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/v1/workforce/applications/${applicationId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      showToast('Status updated')
      void queryClient.invalidateQueries({ queryKey: ['pipeline', roleId] })
    },
    onError: (e: Error) => showToast(e.message),
  })

  if (nextOptions.length === 0) {
    return (
      <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border', STAGE_CHIP[currentStatus] ?? 'bg-cloud text-slate border-rule')}>
        {currentStatus}
      </span>
    )
  }

  return (
    <select
      value={currentStatus}
      disabled={move.isPending}
      onChange={(e) => move.mutate(e.target.value)}
      className={clsx(
        'text-[10px] font-semibold px-2 py-0.5 rounded border cursor-pointer focus:outline-none',
        STAGE_CHIP[currentStatus] ?? 'bg-cloud text-slate border-rule',
      )}
    >
      <option value={currentStatus}>{currentStatus}</option>
      {nextOptions.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Pipeline() {
  const { id: roleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)

  const { data, isLoading } = useQuery<PipelineResponse>({
    queryKey: ['pipeline', roleId],
    queryFn: () => apiFetch<PipelineResponse>(`/api/v1/workforce/roles/${roleId!}/pipeline`),
  } as Parameters<typeof useQuery<PipelineResponse>>[0])

  const counts = data?.counts
  const allApplications: PipelineCandidate[] = data?.applications ?? []
  const visible = stageFilter
    ? allApplications.filter((a) => a.status === stageFilter)
    : allApplications

  return (
    <div>
      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <button onClick={() => navigate('/roles')} className="text-slate hover:text-navy transition-colors">
          ← Roles
        </button>
        <span className="text-slate">/</span>
        <button onClick={() => navigate(`/roles/${roleId!}`)} className="text-slate hover:text-navy transition-colors">
          Role
        </button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">Pipeline</span>
      </div>

      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">Application Pipeline</h1>
        <p className="text-xs text-slate mt-0.5">
          Click a stage count to filter the list. Use the status dropdown on each candidate to advance them through the pipeline.
        </p>
      </div>

      {isLoading && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Loading pipeline…
        </div>
      )}

      {/* ── Stage count tiles ─────────────────────────────────────────────── */}
      {counts && (
        <div className="grid grid-cols-7 gap-2 mb-5">
          {STAGES.map((stage) => {
            const count = counts[stage] ?? 0
            const isActive = stageFilter === stage
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(isActive ? null : stage)}
                className={clsx(
                  'rounded-md border p-3 text-center transition-all',
                  isActive
                    ? clsx('border-transparent shadow-card', STAGE_COUNT_ACTIVE[stage])
                    : 'bg-white border-rule hover:border-accent/40 hover:shadow-card',
                )}
              >
                <div className={clsx('text-2xl font-bold leading-none tabular-nums', isActive ? 'text-white' : 'text-navy')}>
                  {count}
                </div>
                <div className={clsx('text-[9px] font-semibold mt-1 uppercase tracking-wider', isActive ? 'text-white/80' : 'text-slate')}>
                  {stage}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Filter label ────────────────────────────────────────────────────── */}
      {stageFilter && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate">Showing:</span>
          <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border', STAGE_CHIP[stageFilter])}>
            {stageFilter}
          </span>
          <button
            onClick={() => setStageFilter(null)}
            className="text-[10px] text-slate hover:text-accent underline ml-1"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* ── Candidate list ────────────────────────────────────────────────── */}
      {!isLoading && visible.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-10 text-center">
          <div className="text-sm font-semibold text-navy mb-1">
            {stageFilter ? `No candidates in ${stageFilter}` : 'No applications yet'}
          </div>
          <p className="text-xs text-slate">
            {stageFilter
              ? 'Try a different stage filter or clear to see all candidates.'
              : 'Candidates will appear here once learners apply via the Talent portal.'}
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Candidate ID', 'Band', 'Match Score', 'Status', 'Applied'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((candidate) => (
                <tr
                  key={candidate.id}
                  className="border-b border-rule last:border-0 hover:bg-cloud/50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-[11px] text-slate">{candidate.learnerId}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border', BAND_CHIP[candidate.band] ?? 'bg-cloud text-slate border-rule')}>
                      {candidate.band}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'text-sm font-bold tabular-nums',
                        candidate.matchScore >= 80
                          ? 'text-green-700'
                          : candidate.matchScore >= 65
                          ? 'text-amber-600'
                          : 'text-red-600',
                      )}
                    >
                      {candidate.matchScore}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChanger
                      applicationId={candidate.id}
                      currentStatus={candidate.status}
                      roleId={roleId!}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate tabular-nums">
                    {new Date(candidate.appliedAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
