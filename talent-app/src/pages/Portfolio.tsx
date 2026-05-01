/**
 * Portfolio page — BC 86-90
 *
 * Surfaces:
 *  - Resume: generate (AI), edit, save, export as JSON
 *  - Signal export: signed portable JSON download
 *  - Board Brief export: signed board-facing JSON download
 *  - Consent guard: greys out "Generate Resume" + tooltip when opportunity-matching revoked
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import clsx from 'clsx'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResumeSection {
  type: string
  title: string
  items: {
    title?: string
    subtitle?: string
    period?: string
    bullets?: string[]
    tags?: string[]
  }[]
}

interface GeneratedResume {
  id: string
  headline: string
  summary: string
  sections: ResumeSection[]
  createdAt: string
}

interface SavedResumeExport {
  id: string
  headline: string
  summary: string
  sections: ResumeSection[]
  exportedAt: string
}

interface ConsentStatus {
  purpose: string
  granted: boolean
  grantedAt: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Consent hook ─────────────────────────────────────────────────────────────

function useOpportunityMatchingConsent() {
  // The consent PATCH endpoint is at /api/v1/talent/me/consent/:purpose
  // We read from /api/v1/talent/me/consent to check current state.
  // If that endpoint doesn't exist we fall back to optimistic "granted".
  return useQuery<{ consents: ConsentStatus[] }>({
    queryKey: ['my-consents'],
    queryFn: () => apiFetch('/api/v1/talent/me/consents'),
    retry: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

// ─── Section preview component ────────────────────────────────────────────────

function SectionEditor({
  sections,
  onChange,
}: {
  sections: ResumeSection[]
  onChange: (s: ResumeSection[]) => void
}) {
  return (
    <div className="space-y-4">
      {sections.map((sec, si) => (
        <div key={si} className="border border-rule rounded-md p-4 bg-cloud/40">
          <div className="flex items-center justify-between mb-2">
            <input
              className="font-semibold text-sm text-navy border-b border-transparent focus:border-accent outline-none bg-transparent flex-1"
              value={sec.title}
              onChange={(e) => {
                const next = [...sections]
                next[si] = { ...next[si], title: e.target.value }
                onChange(next)
              }}
            />
            <span className="text-[10px] text-slate uppercase tracking-wider ml-3">{sec.type}</span>
          </div>
          {sec.items.map((item, ii) => (
            <div key={ii} className="ml-3 mb-3 border-l-2 border-accent/30 pl-3">
              <input
                className="text-sm font-medium text-navy border-b border-transparent focus:border-accent outline-none bg-transparent w-full mb-0.5"
                value={item.title ?? ''}
                placeholder="Item title"
                onChange={(e) => {
                  const next = [...sections]
                  const items = [...next[si].items]
                  items[ii] = { ...items[ii], title: e.target.value }
                  next[si] = { ...next[si], items }
                  onChange(next)
                }}
              />
              {item.subtitle && (
                <div className="text-[11px] text-slate">{item.subtitle}</div>
              )}
              {item.bullets && item.bullets.map((b, bi) => (
                <div key={bi} className="flex items-start gap-1.5 mt-1">
                  <span className="text-accent mt-0.5 flex-shrink-0">•</span>
                  <input
                    className="text-[12px] text-ink border-b border-transparent focus:border-accent/50 outline-none bg-transparent w-full"
                    value={b}
                    onChange={(e) => {
                      const next = [...sections]
                      const items = [...next[si].items]
                      const bullets = [...(items[ii].bullets ?? [])]
                      bullets[bi] = e.target.value
                      items[ii] = { ...items[ii], bullets }
                      next[si] = { ...next[si], items }
                      onChange(next)
                    }}
                  />
                </div>
              ))}
              {item.tags && item.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {item.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-rule text-slate">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Portfolio() {
  const qc = useQueryClient()

  // Resume state
  const [generatedResume, setGeneratedResume] = useState<GeneratedResume | null>(null)
  const [editHeadline, setEditHeadline] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editSections, setEditSections] = useState<ResumeSection[]>([])
  const [roleId, setRoleId] = useState('')
  const [showRoleInput, setShowRoleInput] = useState(false)

  // Consent query — read whether opportunity-matching is currently granted
  const consentQ = useOpportunityMatchingConsent()
  // Determine consent status — if endpoint not available, assume granted (optimistic)
  const consentGranted: boolean = (() => {
    if (consentQ.isError) return true // endpoint may not exist yet
    if (!consentQ.data) return true   // loading — optimistic
    const record = consentQ.data.consents?.find((c) => c.purpose === 'opportunity-matching')
    return record?.granted !== false  // absent = default granted
  })()

  // Existing resume export query
  const exportQ = useQuery<SavedResumeExport>({
    queryKey: ['resume-export'],
    queryFn: () => apiFetch('/api/v1/talent/me/resume/export'),
    retry: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  // BC 86 — Generate Resume
  const generateMutation = useMutation<GeneratedResume, Error, { roleId?: string }>({
    mutationFn: (body) =>
      apiFetch('/api/v1/talent/me/resume/generate', {
        method: 'POST',
        body: JSON.stringify(body.roleId ? { roleId: body.roleId } : {}),
      }),
    onSuccess: (data) => {
      setGeneratedResume(data)
      setEditHeadline(data.headline)
      setEditSummary(data.summary)
      setEditSections(data.sections)
      showToast('Resume generated!', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  // BC 87 — Save Resume
  const saveMutation = useMutation<{ id: string; updatedAt: string }, Error, void>({
    mutationFn: () =>
      apiFetch('/api/v1/talent/me/resume', {
        method: 'POST',
        body: JSON.stringify({
          headline: editHeadline,
          summary: editSummary,
          sections: editSections,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resume-export'] })
      showToast('Resume saved!', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  // BC 88 — Export Resume (JSON download)
  const exportResumeMutation = useMutation<SavedResumeExport, Error, void>({
    mutationFn: () => apiFetch('/api/v1/talent/me/resume/export'),
    onSuccess: (data) => {
      downloadJson(data, `gradium-resume-${new Date().toISOString().slice(0, 10)}.json`)
      showToast('Resume exported!', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  // BC 89 — Export Signal
  const exportSignalMutation = useMutation<unknown, Error, void>({
    mutationFn: () => apiFetch('/api/v1/talent/me/signal/export'),
    onSuccess: (data) => {
      downloadJson(data, `gradium-signal-${new Date().toISOString().slice(0, 10)}.json`)
      showToast('Signal exported!', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  // BC 90 — Export Board Brief
  const exportBriefMutation = useMutation<unknown, Error, void>({
    mutationFn: () => apiFetch('/api/v1/talent/me/signal/board-brief'),
    onSuccess: (data) => {
      downloadJson(data, `gradium-board-brief-${new Date().toISOString().slice(0, 10)}.json`)
      showToast('Board Brief exported!', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  const hasEditableResume = !!generatedResume
  const hasSavedResume = exportQ.data !== undefined && !exportQ.isError

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">Your Portfolio</h1>
        <p className="text-xs text-slate mt-0.5">
          Generate, edit, and export your AI-tailored resume. Export signed Signal and Board Brief credentials for sharing.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">

        {/* ── Left column: Resume ──────────────────────────────────────────── */}
        <div className="md:col-span-8 space-y-4">

          {/* Generate card */}
          <div className="bg-white border border-rule rounded-md shadow-card p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-sm font-bold text-navy">AI Resume</h2>
                <p className="text-[11px] text-slate mt-0.5 max-w-md">
                  Generates a structured resume from your GradiumOS Signal and past work. Tailor to a specific role by providing a Role ID.
                </p>
              </div>

              {/* Consent warning */}
              {!consentGranted && (
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-[11px] text-amber-700 max-w-[200px]">
                  <span>⚠</span>
                  <span>Enable <strong>opportunity-matching</strong> consent in Profile → Consent to unlock.</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setShowRoleInput(!showRoleInput)}
                className="text-[11px] text-accent hover:underline"
              >
                {showRoleInput ? '− Hide role targeting' : '+ Target a specific role'}
              </button>
            </div>

            {showRoleInput && (
              <div className="mb-4">
                <label className="block text-[11px] font-semibold text-navy mb-1">Role ID (optional)</label>
                <input
                  type="text"
                  placeholder="Paste a Role ID from Opportunities"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full text-sm px-3 py-1.5 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <div title={!consentGranted ? 'Enable opportunity-matching consent to generate a resume' : ''}>
                <button
                  onClick={() => generateMutation.mutate({ roleId: roleId.trim() || undefined })}
                  disabled={!consentGranted || generateMutation.isPending}
                  className={clsx(
                    'px-4 py-2 text-sm font-semibold rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                    consentGranted
                      ? 'bg-accent text-white hover:bg-accent/90'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                  )}
                >
                  {generateMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Generating…
                    </span>
                  ) : (
                    'Generate Resume'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Editable Resume Preview — BC 173: overflow-x-auto so it scrolls on mobile */}
          {hasEditableResume && (
            <div className="bg-white border border-rule rounded-md shadow-card p-5 overflow-x-auto">
              <div className="mb-4">
                <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-2">Headline</div>
                <input
                  className="w-full text-base font-bold text-navy border border-rule rounded px-3 py-2 focus:outline-none focus:border-accent"
                  value={editHeadline}
                  onChange={(e) => setEditHeadline(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-2">Summary</div>
                <textarea
                  rows={4}
                  className="w-full text-[13px] text-ink border border-rule rounded px-3 py-2 focus:outline-none focus:border-accent resize-y"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />
              </div>

              <div className="mb-4">
                <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-2">Sections</div>
                <SectionEditor sections={editSections} onChange={setEditSections} />
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 bg-navy text-white text-sm font-semibold rounded hover:bg-navy/90 transition-colors disabled:opacity-60"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Resume'}
                </button>

                <button
                  onClick={() => exportResumeMutation.mutate()}
                  disabled={exportResumeMutation.isPending}
                  className="px-4 py-2 bg-white border border-rule text-navy text-sm font-semibold rounded hover:bg-cloud transition-colors disabled:opacity-60"
                >
                  {exportResumeMutation.isPending ? 'Exporting…' : 'Export PDF-ready JSON'}
                </button>
              </div>
            </div>
          )}

          {/* Existing saved resume export */}
          {!hasEditableResume && hasSavedResume && (
            <div className="bg-white border border-rule rounded-md shadow-card p-5">
              <h2 className="text-sm font-bold text-navy mb-1">Saved Resume</h2>
              <p className="text-[12px] text-slate mb-3">{exportQ.data!.headline}</p>
              <button
                onClick={() => exportResumeMutation.mutate()}
                disabled={exportResumeMutation.isPending}
                className="px-4 py-2 bg-white border border-rule text-navy text-sm font-semibold rounded hover:bg-cloud transition-colors disabled:opacity-60"
              >
                {exportResumeMutation.isPending ? 'Exporting…' : 'Export PDF-ready JSON'}
              </button>
            </div>
          )}
        </div>

        {/* ── Right column: Signal exports ─────────────────────────────────── */}
        <div className="md:col-span-4 space-y-4">

          {/* Signal Export */}
          <div className="bg-white border border-rule rounded-md shadow-card p-5">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">Portable Signal</div>
            <h2 className="text-sm font-bold text-navy mb-1">Export Signal</h2>
            <p className="text-[11px] text-slate mb-4 leading-relaxed">
              Ed25519-signed JWT with your verified competency bands. Share with employers or paste into any GradiumOS verifier. No raw scores — band labels only.
            </p>
            <button
              onClick={() => exportSignalMutation.mutate()}
              disabled={exportSignalMutation.isPending}
              className="w-full px-4 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent/90 transition-colors disabled:opacity-60"
            >
              {exportSignalMutation.isPending ? 'Signing…' : 'Export Signal →'}
            </button>
          </div>

          {/* Board Brief Export */}
          <div className="bg-white border border-rule rounded-md shadow-card p-5">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">Board Brief</div>
            <h2 className="text-sm font-bold text-navy mb-1">Export Board Brief</h2>
            <p className="text-[11px] text-slate mb-4 leading-relaxed">
              Signed credential summarising your top cluster bands + top 3 employer matches by fit. Designed for placement officers and board presentations.
            </p>
            <button
              onClick={() => exportBriefMutation.mutate()}
              disabled={exportBriefMutation.isPending}
              className="w-full px-4 py-2.5 bg-navy text-white text-sm font-semibold rounded hover:bg-navy/90 transition-colors disabled:opacity-60"
            >
              {exportBriefMutation.isPending ? 'Signing…' : 'Export Board Brief →'}
            </button>
          </div>

          {/* Verifier link info */}
          <div className="bg-cloud border border-rule rounded-md p-4">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">Verifier</div>
            <p className="text-[11px] text-slate leading-relaxed">
              Anyone can verify a Signal at <span className="font-mono text-accent">/verify/&#123;signalId&#125;</span> — no login required.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
