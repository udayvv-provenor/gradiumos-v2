/**
 * PrivacySettings — DPDP granular consent management for learners.
 *
 * Three sections:
 *  1. Data processing consent — 4 per-purpose toggles (ConsentPanel)
 *  2. Data portability — one-click JSON export
 *  3. Right to erasure — account deletion with 30-day cooldown
 *
 * Backend:
 *  GET  /api/v1/talent/me/consents          → { consents: { purpose, granted, grantedAt }[] }
 *  PATCH /api/v1/talent/me/consent/:purpose  → { purpose, granted, grantedAt }
 *  POST  /api/v1/talent/me/data/export       → { jobId }
 *  DELETE /api/v1/talent/me/account          → { message, erasureAt }
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { ConsentPanel, type ConsentValues, type ConsentPurpose } from '../components/ConsentPanel'

// ─── Backend ↔ Frontend purpose-key mapping ────────────────────────────────
// Backend stores 'tutor-AI'; ConsentPanel uses 'tutor-ai'.
const BACKEND_TO_FRONTEND: Record<string, ConsentPurpose> = {
  'assessment-grading':  'assessment-grading',
  'tutor-AI':            'tutor-ai',
  'opportunity-matching':'opportunity-matching',
  'analytics':           'analytics',
}
const FRONTEND_TO_BACKEND: Record<ConsentPurpose, string> = {
  'assessment-grading':  'assessment-grading',
  'tutor-ai':            'tutor-AI',
  'opportunity-matching':'opportunity-matching',
  'analytics':           'analytics',
}

interface ConsentRecord {
  purpose: string
  granted: boolean
  grantedAt: string
}

const DEFAULT_VALUES: ConsentValues = {
  'assessment-grading':   true,
  'tutor-ai':             true,
  'opportunity-matching': true,
  analytics:              true,
}

function buildValues(records: ConsentRecord[]): ConsentValues {
  const v = { ...DEFAULT_VALUES }
  for (const r of records) {
    const fe = BACKEND_TO_FRONTEND[r.purpose]
    if (fe) v[fe] = r.granted
  }
  return v
}

export default function PrivacySettings() {
  const qc = useQueryClient()
  const [deletePending, setDeletePending] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)

  // ── Fetch current consent state ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const consentsQ = useQuery<{ consents: ConsentRecord[] }>({
    queryKey: ['my-consents'],
    queryFn: () => apiFetch('/api/v1/talent/me/consents'),
    staleTime: 30_000,
  } as any) as { data: { consents: ConsentRecord[] } | undefined; isLoading: boolean; isError: boolean }

  const values: ConsentValues = consentsQ.data
    ? buildValues(consentsQ.data.consents)
    : DEFAULT_VALUES

  // ── Consent PATCH mutation ────────────────────────────────────────────────
  const consentMut = useMutation<
    { purpose: string; granted: boolean },
    Error,
    { purpose: ConsentPurpose; granted: boolean }
  >({
    mutationFn: ({ purpose, granted }) =>
      apiFetch(`/api/v1/talent/me/consent/${FRONTEND_TO_BACKEND[purpose]}`, {
        method: 'PATCH',
        body: JSON.stringify({ granted }),
      }),
    onSuccess: ({ purpose, granted }) => {
      showToast(
        granted ? `${purpose} consent enabled` : `${purpose} consent disabled`,
        'success',
      )
      qc.invalidateQueries({ queryKey: ['my-consents'] })
    },
    onError: (e) => showToast(e.message, 'error'),
  })

  function handleConsentChange(purpose: ConsentPurpose, granted: boolean) {
    consentMut.mutate({ purpose, granted })
  }

  // ── Data export mutation ──────────────────────────────────────────────────
  const exportMut = useMutation<{ jobId: string }, Error, void>({
    mutationFn: () =>
      apiFetch('/api/v1/talent/me/data/export', { method: 'POST' }),
    onSuccess: ({ jobId }) =>
      showToast(
        `Export queued (job ${jobId.slice(0, 8)}…). You'll receive an email when ready.`,
        'success',
      ),
    onError: (e) => showToast(e.message, 'error'),
  })

  // ── Account erasure mutation ──────────────────────────────────────────────
  const erasureMut = useMutation<{ message: string; erasureAt: string }, Error, void>({
    mutationFn: () =>
      apiFetch('/api/v1/talent/me/account', { method: 'DELETE' }),
    onSuccess: ({ erasureAt }) => {
      const dateStr = new Date(erasureAt).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
      showToast(`Erasure queued. Your data will be deleted by ${dateStr}.`, 'success')
      setDeletePending(false)
      setDeleteConfirmed(false)
    },
    onError: (e) => {
      showToast(e.message, 'error')
      setDeletePending(false)
    },
  })

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[19px] font-bold text-navy">Privacy &amp; Data</h1>
        <p className="text-xs text-slate mt-0.5">
          Manage how GradiumOS processes your data. Your rights under India&rsquo;s Digital Personal Data Protection Act (DPDP Act, 2023) are fully supported.
        </p>
      </div>

      {/* ── Section 1: Consent ─────────────────────────────────────────────── */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5 mb-5">
        {consentsQ.isLoading ? (
          <div className="text-sm text-slate py-4 text-center">Loading consent state…</div>
        ) : consentsQ.isError ? (
          <div className="text-sm text-red-600 py-4">
            Could not load consent state — please refresh.
          </div>
        ) : (
          <ConsentPanel
            values={values}
            onChange={handleConsentChange}
          />
        )}
        {consentMut.isPending && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            Saving…
          </div>
        )}
      </div>

      {/* ── Section 2: Data portability ────────────────────────────────────── */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5 mb-5">
        <h2 className="text-sm font-semibold text-navy mb-1">Data portability</h2>
        <p className="text-xs text-slate mb-4 leading-relaxed">
          Download a complete copy of your GradiumOS data — competency scores, assessment attempts, tutor session transcripts, resume, and Signal claim — as a machine-readable JSON file.
          <br />
          <span className="text-[10px] text-slate/70 mt-1 block">
            Processing takes up to 24 hours. You&rsquo;ll receive an email when your export is ready.
          </span>
        </p>
        <button
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-navy text-white text-xs font-semibold rounded hover:bg-navy/90 transition-colors disabled:opacity-50"
        >
          {exportMut.isPending ? (
            <>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Queuing export…
            </>
          ) : (
            <>
              <span>↓</span>
              Request data export
            </>
          )}
        </button>
      </div>

      {/* ── Section 3: Right to erasure ────────────────────────────────────── */}
      <div className="bg-white border border-red-200 rounded-md shadow-card p-5">
        <h2 className="text-sm font-semibold text-red-700 mb-1">Right to erasure</h2>
        <p className="text-xs text-slate mb-4 leading-relaxed">
          Request deletion of your account and all associated data. Under the DPDP Act, erasure is queued and completed within 30 days. This action cannot be undone.
          <br />
          <span className="text-[10px] text-slate/70 mt-1 block">
            Erasure does not affect anonymised aggregate statistics (cohort-level benchmarks) from which you cannot be re-identified.
          </span>
        </p>

        {!deletePending ? (
          <button
            onClick={() => setDeletePending(true)}
            className="px-4 py-2 bg-white border border-red-300 text-red-700 text-xs font-semibold rounded hover:bg-red-50 transition-colors"
          >
            Request account deletion
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-xs text-red-800 font-semibold mb-2">
              Are you sure? This will permanently delete your account.
            </p>
            <label className="flex items-center gap-2 text-xs text-red-700 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={deleteConfirmed}
                onChange={e => setDeleteConfirmed(e.target.checked)}
                className="accent-red-600"
              />
              I understand this cannot be undone
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => erasureMut.mutate()}
                disabled={!deleteConfirmed || erasureMut.isPending}
                className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {erasureMut.isPending ? 'Processing…' : 'Confirm deletion'}
              </button>
              <button
                onClick={() => { setDeletePending(false); setDeleteConfirmed(false) }}
                className="px-4 py-2 bg-white border border-rule text-slate text-xs font-semibold rounded hover:bg-cloud transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-slate/60 mt-5 leading-relaxed">
        GradiumOS processes your data under the Digital Personal Data Protection Act, 2023 (India). For data grievances, contact{' '}
        <a href="mailto:privacy@veranox.com" className="underline">privacy@veranox.com</a>.
        Your consent history is retained as an audit trail as required by law.
      </p>
    </div>
  )
}
