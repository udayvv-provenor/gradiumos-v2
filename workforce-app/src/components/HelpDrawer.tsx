/**
 * BC 171 + BC 172 — HelpDrawer (Workforce portal)
 *
 * Slide-in help panel. Three tabs: Docs, Contact, Status.
 * FAQ content is workforce-specific.
 */
import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api'
import clsx from 'clsx'

type Tab = 'docs' | 'contact' | 'status'
type FeedbackType = 'bug' | 'suggestion' | 'question'

interface HealthData {
  status: 'ok' | string
  version?: string
  commit?: string
}

interface FeedbackResponse {
  id: string
}

// ─── Docs tab ─────────────────────────────────────────────────────────────────

function DocsTab() {
  const faqs: { q: string; a: string }[] = [
    {
      q: 'How do I upload a Job Description (JD)?',
      a: 'Go to Career Tracks, select a track, then press "Post Role". Paste or type the JD — GradiumOS will extract cluster requirements automatically and set the target bar for each of the 8 clusters.',
    },
    {
      q: 'What is the GradiumOS Signal?',
      a: 'The Signal is a verified competency credential held by learners. Each candidate card shows their Signal score and band, so you can make data-backed shortlist decisions without relying on CVs alone.',
    },
    {
      q: 'How do I view matched candidates for a role?',
      a: 'Open a role under Career Tracks and switch to the "Candidates" tab. Candidates are ranked by match score — the percentage of cluster requirements they meet based on their verified Signal.',
    },
    {
      q: 'How do I view cohort gaps?',
      a: 'The Dashboard shows aggregate gap analysis across all applicants for your open roles. Campus administrators can share cohort gap reports directly with you via the Campus portal.',
    },
    {
      q: 'What does the radar chart show?',
      a: 'The radar chart on each candidate card overlays the candidate\'s verified cluster scores (violet) against your role\'s target bar (amber) across all 8 clusters. Gaps are immediately visible.',
    },
  ]

  return (
    <div className="space-y-4">
      {faqs.map(({ q, a }) => (
        <div key={q} className="border border-rule rounded-md p-4">
          <div className="text-sm font-semibold text-navy mb-1">{q}</div>
          <p className="text-xs text-slate leading-relaxed">{a}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Contact tab ──────────────────────────────────────────────────────────────

function ContactTab() {
  const [type, setType] = useState<FeedbackType>('question')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch<FeedbackResponse>('/api/v1/feedback', {
        method: 'POST',
        body: JSON.stringify({
          type,
          message: message.trim(),
          page: window.location.pathname,
        }),
      })
      setSuccessId(res.id)
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (successId) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-md p-5 text-sm text-green-800">
        <div className="font-semibold mb-1">Ticket #{successId} submitted.</div>
        <p className="text-xs">We'll follow up within 2 business days.</p>
        <button
          onClick={() => setSuccessId(null)}
          className="mt-3 text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="feedback-type" className="block text-xs font-semibold text-navy mb-1">
          Type
        </label>
        <select
          id="feedback-type"
          value={type}
          onChange={(e) => setType(e.target.value as FeedbackType)}
          className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent"
        >
          <option value="question">Question</option>
          <option value="bug">Bug report</option>
          <option value="suggestion">Suggestion</option>
        </select>
      </div>

      <div>
        <label htmlFor="feedback-message" className="block text-xs font-semibold text-navy mb-1">
          Message
        </label>
        <textarea
          id="feedback-message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your question, bug, or suggestion…"
          className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent resize-y"
          required
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !message.trim()}
        className="w-full py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  )
}

// ─── Status tab ───────────────────────────────────────────────────────────────

function StatusTab() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchFailed, setFetchFailed] = useState(false)

  useEffect(() => {
    apiFetch<HealthData>('/api/v1/health')
      .then((d) => { setHealth(d); setLoading(false) })
      .catch(() => { setFetchFailed(true); setLoading(false) })
  }, [])

  if (loading) {
    return <div className="text-sm text-slate py-4 text-center">Checking status…</div>
  }

  if (fetchFailed || !health) {
    return (
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-sm text-amber-800">
        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
        Status check unavailable
      </div>
    )
  }

  const isOk = health.status === 'ok'

  return (
    <div className="space-y-3">
      <div
        className={clsx(
          'flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium',
          isOk
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-amber-50 border border-amber-200 text-amber-800',
        )}
      >
        <span
          aria-hidden="true"
          className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', isOk ? 'bg-green-500' : 'bg-amber-400')}
        />
        {isOk ? 'All systems operational' : `Status: ${health.status}`}
      </div>
      {(health.version || health.commit) && (
        <div className="text-xs text-slate space-y-1 px-1">
          {health.version && <div><span className="font-semibold text-navy">Version:</span> {health.version}</div>}
          {health.commit && <div><span className="font-semibold text-navy">Commit:</span> <span className="font-mono">{health.commit.slice(0, 8)}</span></div>}
        </div>
      )}
    </div>
  )
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export interface HelpDrawerProps {
  open: boolean
  onClose: () => void
  portal?: 'talent' | 'workforce' | 'campus'
}

export function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  const [tab, setTab] = useState<Tab>('docs')
  const drawerRef = useRef<HTMLDivElement>(null)
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => firstFocusRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'docs', label: 'Docs' },
    { key: 'contact', label: 'Contact' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden="true" />}

      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        className={clsx(
          'fixed top-0 right-0 h-full w-[380px] bg-white shadow-modal z-50 flex flex-col transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
          <h2 className="text-sm font-semibold text-ink">Help &amp; Support</h2>
          <button
            ref={firstFocusRef}
            onClick={onClose}
            aria-label="Close help panel"
            className="text-slate hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-rule px-5" role="tablist" aria-label="Help sections">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`help-panel-${key}`}
              id={`help-tab-${key}`}
              onClick={() => setTab(key)}
              className={clsx(
                'py-3 px-1 mr-5 text-xs font-semibold border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-sm',
                tab === key ? 'border-accent text-accent' : 'border-transparent text-slate hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div id="help-panel-docs" role="tabpanel" aria-labelledby="help-tab-docs" hidden={tab !== 'docs'}>
            {tab === 'docs' && <DocsTab />}
          </div>
          <div id="help-panel-contact" role="tabpanel" aria-labelledby="help-tab-contact" hidden={tab !== 'contact'}>
            {tab === 'contact' && <ContactTab />}
          </div>
          <div id="help-panel-status" role="tabpanel" aria-labelledby="help-tab-status" hidden={tab !== 'status'}>
            {tab === 'status' && <StatusTab />}
          </div>
        </div>
      </div>
    </>
  )
}
