/**
 * BC 120 — /applications — Learner's application tracker
 *
 * Lists all applications with status chip, last-updated timestamp,
 * next-expected-action text, and a Withdraw button for active states.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { ApplicationRecord, ApplicationsResponse, ApplicationStatus } from '../types'
import clsx from 'clsx'

// ─── Status chip styling ─────────────────────────────────────────────────────

const STATUS_CHIP: Record<ApplicationStatus, string> = {
  Applied:    'bg-blue-50 text-blue-700 border-blue-200',
  Shortlisted:'bg-amber-50 text-amber-700 border-amber-200',
  Interview:  'bg-violet-50 text-violet-700 border-violet-200',
  Offer:      'bg-green-50 text-green-700 border-green-200',
  Accepted:   'bg-green-100 text-green-800 border-green-300',
  Declined:   'bg-red-50 text-red-700 border-red-200',
  Withdrawn:  'bg-slate-100 text-slate-500 border-slate-200',
}

const ACTIVE_STATUSES = new Set<ApplicationStatus>(['Applied', 'Shortlisted', 'Interview', 'Offer'])

function StatusChip({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border',
        STATUS_CHIP[status] ?? 'bg-cloud text-slate border-rule',
      )}
    >
      {status}
    </span>
  )
}

// ─── Withdraw button ─────────────────────────────────────────────────────────

function WithdrawButton({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient()
  const [confirmed, setConfirmed] = useState(false)

  const withdraw = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; status: string }>(
        `/api/v1/talent/me/applications/${applicationId}/withdraw`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      showToast('Application withdrawn.')
      void queryClient.invalidateQueries({ queryKey: ['v1-my-applications'] })
      void queryClient.invalidateQueries({ queryKey: ['v1-opportunities'] })
    },
    onError: (e: Error) => showToast(e.message),
  })

  if (!confirmed) {
    return (
      <button
        onClick={() => setConfirmed(true)}
        className="text-[10px] text-slate hover:text-red-600 transition-colors underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
      >
        Withdraw
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate">Confirm?</span>
      <button
        onClick={() => withdraw.mutate()}
        disabled={withdraw.isPending}
        className="text-[10px] font-semibold text-red-600 hover:underline disabled:opacity-60"
      >
        {withdraw.isPending ? 'Withdrawing…' : 'Yes, withdraw'}
      </button>
      <button
        onClick={() => setConfirmed(false)}
        className="text-[10px] text-slate hover:text-navy"
      >
        Cancel
      </button>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Applications() {
  const { data, isLoading } = useQuery<ApplicationsResponse>({
    queryKey: ['v1-my-applications'],
    queryFn: () => apiFetch<ApplicationsResponse>('/api/v1/talent/me/applications'),
  } as Parameters<typeof useQuery<ApplicationsResponse>>[0])

  const applications: ApplicationRecord[] = data?.applications ?? []

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">My Applications</h1>
        <p className="text-xs text-slate mt-0.5">
          Track the status of every role you have applied to. Withdraw at any time while your application is active.
        </p>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Loading your applications…
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {!isLoading && applications.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">📋</div>
          <div className="text-sm font-semibold text-navy mb-1">No applications yet</div>
          <p className="text-xs text-slate max-w-sm mx-auto">
            Browse Opportunities and apply to roles that match your competency signal.
          </p>
        </div>
      )}

      {/* ── Application list ───────────────────────────────────────────────── */}
      {applications.length > 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
          {/* BC 173 — overflow-x-auto so table scrolls horizontally on mobile */}
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm min-w-[640px]">
            <thead>
              <tr>
                {['Role', 'Employer', 'Status', 'Next action', 'Applied', 'Last update', ''].map((h) => (
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
              {applications.map((app) => (
                <tr
                  key={app.id}
                  className="border-b border-rule last:border-0 hover:bg-cloud/50 transition-colors"
                >
                  <td className="px-4 py-3 font-semibold text-navy max-w-[220px] truncate">
                    {app.roleTitle}
                  </td>
                  <td className="px-4 py-3 text-slate text-xs">{app.employerName}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={app.status as ApplicationStatus} />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate italic">{app.nextAction}</td>
                  <td className="px-4 py-3 text-xs text-slate tabular-nums">
                    {new Date(app.appliedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate tabular-nums">
                    {new Date(app.statusUpdatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    {ACTIVE_STATUSES.has(app.status as ApplicationStatus) && (
                      <WithdrawButton applicationId={app.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
