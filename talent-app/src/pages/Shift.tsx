/* Shift — the headline assessment popup of v3. NOT teaching, NOT learning.
 * The learner is dropped into a single fictional company for ~25 minutes,
 * handles 3-5 heterogeneous artifacts (PR diff, Slack thread, log, customer
 * email, meeting note), gets per-artifact AI grading + an end-of-shift
 * readout. Submissions feed CompetencyScore via the locked formulas.
 *
 * v3.1.5 — first build per Uday's "work-simulation, market-release-grade"
 * call. Architecture follows agents/ideas/2026-04-27_work_simulation_popup_spec.md.
 */
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { RadarChart } from '../components/RadarChart'
import clsx from 'clsx'

interface ShiftArtifact {
  id: string
  clusterCode: string
  artifactKind: 'pr-diff'|'slack'|'incident-log'|'customer-email'|'meeting-note'|'design-doc'
  label: string
  body: string
  task: string
  rubric: { criterion: string; weight: number }[]
  estimatedMinutes: number
}
interface ShiftScenario {
  companyName: string
  companyContext: string
  role: string
  day: number
  scenarioArc: string
  artifacts: ShiftArtifact[]
}
type ShiftSource = 'live-ai' | 'db-cache' | 'fallback'
interface ShiftFetchResponse {
  scenario: ShiftScenario
  scenarioHash: string
  cached: boolean
  source?: ShiftSource
  model?: string
}
interface Graded {
  score: number
  rubricScore: Record<string, number>
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  oneLine: string
}

const KIND_ICON: Record<ShiftArtifact['artifactKind'], string> = {
  'pr-diff':         '⌥',
  'slack':           '✻',
  'incident-log':    '⚠',
  'customer-email':  '✉',
  'meeting-note':    '◧',
  'design-doc':      '◫',
}
const KIND_LABEL: Record<ShiftArtifact['artifactKind'], string> = {
  'pr-diff':         'PR review',
  'slack':           'Slack reply',
  'incident-log':    'Incident triage',
  'customer-email':  'Customer reply',
  'meeting-note':    'Meeting response',
  'design-doc':      'Design feedback',
}

export default function Shift() {
  const navigate = useNavigate()
  const [activeIdx, setActiveIdx] = useState(0)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [grades, setGrades] = useState<Record<string, Graded>>({})
  const [shiftDone, setShiftDone] = useState(false)

  // Fetch scenario
  const sq = useQuery({
    queryKey: ['shift-scenario'],
    queryFn: () => apiFetch<ShiftFetchResponse>('/api/talent/me/shift'),
    staleTime: 24 * 60 * 60 * 1000,    // a shift is the same all day
  } as any) as { data: ShiftFetchResponse | undefined; isLoading: boolean; error: Error | null }
  const scenario = sq.data?.scenario
  const scenarioHash = sq.data?.scenarioHash
  const source: ShiftSource = sq.data?.source ?? (sq.data?.cached ? 'db-cache' : 'live-ai')

  // In-shift tutor drawer state (v3.1.6)
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorMessages, setTutorMessages] = useState<{ role: 'user'|'assistant'; content: string }[]>([])
  const [tutorInput, setTutorInput] = useState('')
  const [tutorSaveMode, setTutorSaveMode] = useState(false)
  const [tutorSaved, setTutorSaved] = useState<string[]>([])
  const [tutorBusy, setTutorBusy] = useState(false)

  // Submit one artifact (v3.1.6 — passes scenarioHash so server can persist to WorkShift)
  const submitMut = useMutation<{ graded: Graded }, Error, { artifact: ShiftArtifact; response: string }>({
    mutationFn: ({ artifact, response }) =>
      apiFetch('/api/talent/me/shift/grade', {
        method: 'POST',
        body: JSON.stringify({
          artifactId:  artifact.id,
          clusterCode: artifact.clusterCode,
          task:        artifact.task,
          rubric:      artifact.rubric,
          response,
          scenarioHash,
          companyName: scenario?.companyName,
        }),
      }),
    onSuccess: (data, vars) => {
      setGrades((g) => ({ ...g, [vars.artifact.id]: data.graded }))
      showToast(`Graded — ${data.graded.score}/100`, 'success')
    },
    onError: (e) => showToast(e.message),
  })

  // 25-min countdown (display-only — non-blocking)
  const totalSec = 25 * 60
  const startedAt = useMemo(() => Date.now(), [scenario?.companyName])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (shiftDone) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [shiftDone])
  const elapsed = Math.floor((now - startedAt) / 1000)
  const remaining = Math.max(0, totalSec - elapsed)
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  // v3.1.7 — timer enforcement. When 0:00 hits, auto-end the shift (the manager
  // would walk over and say "we're out of time"). Submitted artifacts grade as
  // normal; unsubmitted ones are skipped. Avoids the "decorative timer" lie.
  useEffect(() => {
    if (!shiftDone && remaining === 0 && elapsed >= totalSec) {
      setShiftDone(true)
    }
  }, [remaining, elapsed, totalSec, shiftDone])

  // Aggregates
  const submitted = scenario?.artifacts.filter((a) => grades[a.id]) ?? []
  const overallScore = submitted.length > 0
    ? Math.round(submitted.reduce((s, a) => s + grades[a.id].score, 0) / submitted.length)
    : 0
  const allDone = scenario && submitted.length === scenario.artifacts.length

  // Readout cluster heatmap (radar values across 8 clusters)
  const clusterValues = useMemo(() => {
    const values: Record<string, number[]> = { C1: [], C2: [], C3: [], C4: [], C5: [], C6: [], C7: [], C8: [] }
    if (scenario) {
      for (const art of scenario.artifacts) {
        const g = grades[art.id]
        if (g) values[art.clusterCode]?.push(g.score)
      }
    }
    return ['C1','C2','C3','C4','C5','C6','C7','C8'].map((c) => {
      const arr = values[c]
      return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
    })
  }, [scenario, grades])

  // ---------- Loading / error ----------
  if (sq.isLoading || !scenario) {
    return (
      <div className="fixed inset-0 z-50 bg-navy/95 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-4xl mb-4 opacity-60">⚡</div>
          <div className="text-base font-bold mb-1">Setting up your shift…</div>
          <div className="text-xs text-white/60">AI is composing today's situation, artifacts, and rubrics</div>
        </div>
      </div>
    )
  }

  // ---------- End-of-shift readout ----------
  if (shiftDone) {
    // v3.1.7 — manager note now AI-generated server-side. Fire /shift/complete
    // once and stash the returned note + source in component state.
    if (scenarioHash && !(window as any).__shiftCompleteFired) {
      (window as any).__shiftCompleteFired = true
      apiFetch<{ managerNote: string; source: 'live-ai'|'fallback' }>('/api/talent/me/shift/complete', {
        method: 'POST',
        body: JSON.stringify({
          scenarioHash,
          aggregateScore: overallScore,
          clusterHeatmap: { C1: clusterValues[0], C2: clusterValues[1], C3: clusterValues[2], C4: clusterValues[3], C5: clusterValues[4], C6: clusterValues[5], C7: clusterValues[6], C8: clusterValues[7] },
        }),
      }).then((r) => {
        ;(window as any).__shiftCompleteResult = r
      }).catch(() => { /* non-fatal — local fallback used */ })
    }
    const completeRes = (window as any).__shiftCompleteResult as { managerNote: string; source: 'live-ai'|'fallback' } | undefined
    const managerNote = completeRes?.managerNote ?? composeManagerNote(submitted, grades, overallScore)
    const noteSource: 'live-ai' | 'fallback' = completeRes?.source ?? 'fallback'
    return (
      <div className="fixed inset-0 z-50 bg-navy/95 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-md shadow-card p-7">
          <div className="text-center mb-6">
            <div className="text-[10px] font-bold tracking-widest text-slate uppercase mb-1">Shift complete · {scenario.companyName} · Day {scenario.day}</div>
            <h1 className="text-2xl font-bold text-navy">Manager's read-out</h1>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-6 items-center">
            <div>
              <div className="text-center mb-2">
                <div className={clsx('text-6xl font-bold leading-none',
                  overallScore >= 75 ? 'text-green-700' : overallScore >= 55 ? 'text-amber-600' : 'text-red-600',
                )}>{overallScore}</div>
                <div className="text-[11px] text-slate font-semibold uppercase tracking-wider mt-1">Shift score</div>
              </div>
              <div className="bg-cloud rounded p-4 text-[12px] text-ink leading-relaxed italic">
                "{managerNote}"
                <div className="text-[10px] text-slate not-italic mt-2 font-semibold flex items-center gap-2">
                  — Priya, Engineering Manager
                  <SourcePill source={noteSource === 'live-ai' ? 'live-ai' : 'fallback'} />
                </div>
              </div>
            </div>
            <div>
              <RadarChart
                size={300}
                series={[{ label: 'This shift', color: 'violet', values: clusterValues }]}
              />
              <div className="text-center text-[10px] text-slate mt-1">
                Cluster heatmap of how you handled today.
                {(() => {
                  const untouched = ['C1','C2','C3','C4','C5','C6','C7','C8'].filter((_, i) => clusterValues[i] === 0)
                  return untouched.length > 0 ? <span className="block text-amber-700"> {untouched.join(', ')} not exercised this shift — these read as 0 here, not as a true zero score.</span> : null
                })()}
              </div>
            </div>
          </div>

          <div className="border-t border-rule pt-5 mb-5">
            <h3 className="text-sm font-bold text-navy mb-3">Artifact-by-artifact</h3>
            <div className="space-y-2">
              {scenario.artifacts.map((art) => {
                const g = grades[art.id]
                return (
                  <div key={art.id} className="flex items-center justify-between p-3 bg-cloud/40 rounded">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-rule text-slate">{art.clusterCode}</span>
                      <span className="text-xs text-navy font-medium">{art.label}</span>
                    </div>
                    {g ? (
                      <span className={clsx('text-sm font-bold tabular-nums',
                        g.score >= 75 ? 'text-green-700' : g.score >= 55 ? 'text-amber-600' : 'text-red-600',
                      )}>{g.score}/100</span>
                    ) : (
                      <span className="text-[10px] text-slate font-semibold">SKIPPED</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="text-[10px] text-slate mb-5 leading-relaxed bg-amber-50 border border-amber-200 rounded p-3">
            Each scored artifact added an evidence event to your CompetencyScore via the locked GradiumOS formulas. Your dashboard radar will reflect this shift.
          </div>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark"
            >View updated dashboard →</button>
            <button
              onClick={() => navigate('/assessments')}
              className="px-5 py-2.5 bg-cloud text-navy text-sm font-semibold rounded hover:bg-rule"
            >Back to Assessments</button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Active shift — 3-pane overlay ----------
  const active = scenario.artifacts[activeIdx]
  const currentResponse = responses[active.id] ?? ''
  const currentGrade = grades[active.id]

  return (
    <div className="fixed inset-0 z-40 bg-cloud flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-navy text-white shadow-card flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-2xl">⚡</span>
          <div>
            <div className="text-[10px] tracking-widest uppercase text-white/50 font-semibold flex items-center gap-2">
              Shift in progress
              <SourcePill source={source} />
            </div>
            <div className="text-sm font-bold">{scenario.companyName} · Day {scenario.day} · <span className="text-white/70 font-normal">{scenario.role}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold">Time</div>
            <div className={clsx('text-sm font-mono font-bold', remaining < 300 ? 'text-amber-300' : '')}>{mm}:{ss}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-wider text-white/50 font-semibold">Progress</div>
            <div className="text-sm font-bold">{submitted.length} / {scenario.artifacts.length}</div>
          </div>
          <button
            onClick={() => setTutorOpen(true)}
            className="px-3 py-1.5 text-[11px] font-semibold rounded bg-white/10 hover:bg-white/20 text-white border border-white/20"
          >Ask partner ↑</button>
          <button
            onClick={() => {
              if (confirm('End the shift now? Unsubmitted artifacts will be skipped.')) setShiftDone(true)
            }}
            className="px-3 py-1.5 text-[11px] font-semibold rounded bg-white/10 hover:bg-white/20 text-white border border-white/20"
          >End shift →</button>
        </div>
      </div>

      {/* Scenario arc — collapsible context */}
      <details className="bg-white border-b border-rule px-5 py-2 flex-shrink-0" open>
        <summary className="text-[10px] tracking-wider uppercase text-slate font-bold cursor-pointer hover:text-navy">Today's situation</summary>
        <div className="text-xs text-ink leading-relaxed mt-2">
          <div className="mb-1.5"><strong className="text-navy">{scenario.companyName}.</strong> {scenario.companyContext}</div>
          <div>{scenario.scenarioArc}</div>
        </div>
      </details>

      {/* 3-pane body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Inbox */}
        <div className="w-64 bg-white border-r border-rule overflow-y-auto flex-shrink-0">
          <div className="px-4 py-3 border-b border-rule">
            <div className="text-[10px] tracking-wider uppercase text-slate font-bold">Inbox</div>
          </div>
          {scenario.artifacts.map((a, i) => {
            const g = grades[a.id]
            const isActive = i === activeIdx
            return (
              <button
                key={a.id}
                onClick={() => setActiveIdx(i)}
                className={clsx(
                  'w-full text-left px-4 py-3 border-b border-rule/60 transition-colors block',
                  isActive ? 'bg-accent-light/60 border-l-[3px] border-l-accent' : 'hover:bg-cloud/40',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base text-accent">{KIND_ICON[a.artifactKind]}</span>
                  <span className="text-[10px] font-mono text-slate">{a.clusterCode}</span>
                  {g && (
                    <span className={clsx('ml-auto text-[10px] font-bold',
                      g.score >= 75 ? 'text-green-700' : g.score >= 55 ? 'text-amber-600' : 'text-red-600',
                    )}>{g.score}</span>
                  )}
                </div>
                <div className="text-[12.5px] font-semibold text-navy line-clamp-2">{a.label}</div>
                <div className="text-[10px] text-slate mt-0.5">{KIND_LABEL[a.artifactKind]} · {a.estimatedMinutes} min</div>
              </button>
            )
          })}

          {allDone && (
            <div className="p-4">
              <button
                onClick={() => setShiftDone(true)}
                className="w-full py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark"
              >See manager's read-out →</button>
            </div>
          )}
        </div>

        {/* Artifact body */}
        <div className="flex-1 overflow-y-auto bg-white border-r border-rule">
          <div className="px-6 py-4 border-b border-rule">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-light text-accent font-bold">{active.clusterCode}</span>
              <span className="text-[11px] text-slate uppercase tracking-wider font-semibold">{KIND_LABEL[active.artifactKind]}</span>
            </div>
            <h2 className="text-base font-bold text-navy">{active.label}</h2>
          </div>
          <div className="p-6">
            <pre className="bg-slate-50 border border-rule rounded p-4 text-[12px] text-ink leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto">{active.body}</pre>
          </div>
        </div>

        {/* Response pane */}
        <div className="w-[420px] bg-white overflow-y-auto flex-shrink-0">
          <div className="px-5 py-4 border-b border-rule">
            <div className="text-[10px] tracking-wider uppercase text-accent font-bold mb-1">Your deliverable</div>
            <p className="text-[13px] text-navy font-medium leading-relaxed">{active.task}</p>
            <div className="mt-3">
              <div className="text-[9px] uppercase tracking-wider text-slate font-bold mb-1">Graded against</div>
              <ul className="space-y-1">
                {active.rubric.map((r) => (
                  <li key={r.criterion} className="text-[10.5px] text-ink flex items-start gap-1.5">
                    <span className="font-mono text-accent shrink-0">[{Math.round(r.weight * 100)}%]</span>
                    <span>{r.criterion}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="p-5">
            {!currentGrade ? (
              <>
                <textarea
                  value={currentResponse}
                  onChange={(e) => setResponses((r) => ({ ...r, [active.id]: e.target.value }))}
                  placeholder="Write your response here. Be specific. Reference the artifact directly."
                  className="w-full min-h-[220px] border border-rule rounded p-3 text-[12.5px] font-mono leading-relaxed focus:outline-none focus:border-accent"
                  disabled={submitMut.isPending}
                />
                <div className="flex items-center justify-between mt-3">
                  <div className="text-[10px] text-slate">{currentResponse.length} chars · min 10</div>
                  <button
                    disabled={currentResponse.trim().length < 10 || submitMut.isPending}
                    onClick={() => submitMut.mutate({ artifact: active, response: currentResponse })}
                    className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark disabled:opacity-50"
                  >{submitMut.isPending ? 'AI grading…' : 'Submit →'}</button>
                </div>
              </>
            ) : (
              <div>
                <div className="flex items-baseline gap-3 mb-3">
                  <div className={clsx('text-3xl font-bold leading-none',
                    currentGrade.score >= 75 ? 'text-green-700' : currentGrade.score >= 55 ? 'text-amber-600' : 'text-red-600',
                  )}>{currentGrade.score}</div>
                  <div className="text-[10px] text-slate uppercase tracking-wider font-bold">Score</div>
                </div>
                <div className="text-[12px] text-navy font-medium mb-3 italic">"{currentGrade.oneLine}"</div>

                <div className="space-y-2 mb-4">
                  {Object.entries(currentGrade.rubricScore).map(([cri, sc]) => (
                    <div key={cri}>
                      <div className="flex items-center justify-between text-[10px] mb-0.5">
                        <span className="text-ink truncate pr-2">{cri}</span>
                        <span className={clsx('font-bold tabular-nums',
                          sc >= 75 ? 'text-green-700' : sc >= 55 ? 'text-amber-600' : 'text-red-600',
                        )}>{sc}</span>
                      </div>
                      <div className="h-1 bg-cloud rounded-full overflow-hidden">
                        <div className={clsx('h-full',
                          sc >= 75 ? 'bg-green-700' : sc >= 55 ? 'bg-amber-500' : 'bg-red-600',
                        )} style={{ width: `${sc}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {currentGrade.gaps.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2.5 mb-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-amber-800 mb-1">Gaps</div>
                    <ul className="space-y-0.5">
                      {currentGrade.gaps.map((g, i) => <li key={i} className="text-[10.5px] text-ink leading-relaxed">• {g}</li>)}
                    </ul>
                  </div>
                )}
                {currentGrade.suggestions.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2.5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-blue-800 mb-1">Try next</div>
                    <ul className="space-y-0.5">
                      {currentGrade.suggestions.map((s, i) => <li key={i} className="text-[10.5px] text-ink leading-relaxed">• {s}</li>)}
                    </ul>
                  </div>
                )}

                <div className="mt-4">
                  {activeIdx < scenario.artifacts.length - 1 ? (
                    <button
                      onClick={() => setActiveIdx(activeIdx + 1)}
                      className="w-full py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark"
                    >Next artifact →</button>
                  ) : allDone ? (
                    <button
                      onClick={() => setShiftDone(true)}
                      className="w-full py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark"
                    >See manager's read-out →</button>
                  ) : (
                    <div className="text-[11px] text-slate text-center">Select an unsubmitted artifact from the inbox to continue.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* v3.1.6 — In-shift Tutor drawer (Partner mode). Knows the active
       * artifact context — the system prompt on the backend includes the
       * artifact body so the partner can ground its answer in real work,
       * not generic theory. Doubt-save toggle queues the question to a
       * digest at end-of-shift. */}
      {tutorOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={() => setTutorOpen(false)}>
          <div className="w-[420px] h-full bg-white shadow-card flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-rule flex items-center justify-between">
              <div>
                <div className="text-[10px] tracking-widest uppercase text-slate font-bold">In-shift partner</div>
                <div className="text-sm font-bold text-navy">Working on: {active.label}</div>
              </div>
              <button onClick={() => setTutorOpen(false)} className="text-slate hover:text-navy text-lg">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 bg-cloud/20">
              {tutorMessages.length === 0 && (
                <div className="text-[11.5px] text-slate italic leading-relaxed bg-white border border-rule rounded p-3">
                  I'm here as a partner, not a teacher. I know the artifact you're looking at. Ask anything — about the artifact, what to check first, or what frameworks apply. If a question doesn't need an answer right now, hit "Save" and I'll batch it for end-of-shift.
                </div>
              )}
              {tutorMessages.map((m, i) => (
                <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={clsx('max-w-[85%] px-3 py-2 rounded-md text-[12px] leading-relaxed',
                    m.role === 'user' ? 'bg-accent text-white' : 'bg-white border border-rule text-ink',
                  )}>{m.content || (tutorBusy ? <span className="opacity-50 animate-pulse">▌</span> : '')}</div>
                </div>
              ))}
              {tutorSaved.length > 0 && (
                <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                  {tutorSaved.length} doubt{tutorSaved.length === 1 ? '' : 's'} saved for end-of-shift digest
                </div>
              )}
            </div>

            <div className="border-t border-rule p-3 flex flex-col gap-2">
              <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                <input type="checkbox" checked={tutorSaveMode} onChange={(e) => setTutorSaveMode(e.target.checked)} />
                <span className={clsx('font-semibold', tutorSaveMode ? 'text-amber-700' : 'text-slate')}>
                  Save next message for end-of-shift digest
                </span>
              </label>
              <div className="flex gap-2">
                <textarea
                  value={tutorInput}
                  onChange={(e) => setTutorInput(e.target.value)}
                  rows={2}
                  placeholder={tutorSaveMode ? 'Type a doubt to save for later…' : 'Ask the partner about this artifact…'}
                  className={clsx('flex-1 text-[12px] px-2 py-1.5 border rounded resize-none focus:outline-none',
                    tutorSaveMode ? 'border-amber-400 bg-amber-50/30' : 'border-rule focus:border-accent',
                  )}
                  disabled={tutorBusy}
                />
                <button
                  disabled={tutorBusy || !tutorInput.trim()}
                  onClick={async () => {
                    const q = tutorInput.trim()
                    if (!q) return
                    setTutorInput('')
                    if (tutorSaveMode) {
                      setTutorSaved((arr) => [...arr, q])
                      setTutorMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: `_Saved (#${tutorSaved.length + 1}). I'll come back to this in the end-of-shift digest._` }])
                      setTutorSaveMode(false)
                      return
                    }
                    setTutorMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }])
                    setTutorBusy(true)
                    try {
                      // v3.1.7 — proper one-shot in-shift tutor endpoint.
                      // Knows the artifact body. Grounds the answer in real work.
                      // Sends rolling history (last 8 turns) for coherence.
                      const recent = tutorMessages.slice(-8).map((tm) => ({ role: tm.role, content: tm.content }))
                      const r = await apiFetch<{ reply: string }>('/api/talent/me/shift/tutor', {
                        method: 'POST',
                        body: JSON.stringify({
                          question:      q,
                          artifactBody:  active.body,
                          artifactLabel: active.label,
                          clusterCode:   active.clusterCode,
                          history:       recent,
                        }),
                      })
                      setTutorMessages((m) => {
                        const arr = [...m]
                        arr[arr.length - 1] = { role: 'assistant', content: r.reply }
                        return arr
                      })
                    } catch (e) {
                      setTutorMessages((m) => {
                        const arr = [...m]
                        arr[arr.length - 1] = { role: 'assistant', content: `_Could not reach the partner: ${(e as Error).message}_` }
                        return arr
                      })
                    } finally {
                      setTutorBusy(false)
                    }
                  }}
                  className={clsx('px-3 py-1.5 text-white text-[11px] font-semibold rounded disabled:opacity-50',
                    tutorSaveMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent hover:bg-accent-dark',
                  )}
                >{tutorSaveMode ? 'Save' : 'Ask'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* SourcePill — honest indicator of where the scenario data came from.
 * Live AI = freshly pulled from Groq this request.
 * DB cache = pulled from publicDataCache (someone else's earlier live call).
 * Fallback = Groq unreachable, emergency stub. */
function SourcePill({ source }: { source: 'live-ai' | 'db-cache' | 'fallback' }) {
  const map = {
    'live-ai':  { label: 'Live AI',   cls: 'bg-green-500/20 text-green-200 border border-green-400/40' },
    'db-cache': { label: 'DB cache',  cls: 'bg-blue-500/20 text-blue-200 border border-blue-400/40' },
    'fallback': { label: 'Fallback',  cls: 'bg-red-500/20 text-red-200 border border-red-400/40' },
  } as const
  const m = map[source]
  return <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider', m.cls)}>{m.label}</span>
}

/* Compose a one-paragraph manager-style readout from the per-artifact grades.
 * Deterministic — based on the cluster spread + overall score band. */
function composeManagerNote(
  submitted: ShiftArtifact[],
  grades: Record<string, Graded>,
  overall: number,
): string {
  if (submitted.length === 0) return `You ended the shift without submitting any artifacts. That happens — but the only way to learn this work is to actually do it. Take another shift.`

  const top = [...submitted].sort((a, b) => grades[b.id].score - grades[a.id].score)[0]
  const bot = [...submitted].sort((a, b) => grades[a.id].score - grades[b.id].score)[0]
  const topG = grades[top.id]
  const botG = grades[bot.id]

  if (overall >= 75) {
    return `Solid shift. You handled the ${KIND_LABEL[top.artifactKind].toLowerCase()} cleanly — ${topG.oneLine.toLowerCase()} The ${KIND_LABEL[bot.artifactKind].toLowerCase()} was your weakest, but still defensible. If you maintain this level, you'll be trusted with more autonomy quickly.`
  }
  if (overall >= 55) {
    return `Mixed shift. Strongest moment was the ${KIND_LABEL[top.artifactKind].toLowerCase()} — that's the bar to repeat. The ${KIND_LABEL[bot.artifactKind].toLowerCase()} needs work; specifically, ${(botG.gaps[0] ?? 'the underlying judgment').toLowerCase()}. Take another shift focused on that cluster before next sprint.`
  }
  return `Tough shift. Don't read into one rough day, but a few patterns stand out: ${(botG.gaps[0] ?? 'response specificity').toLowerCase()}, and the ${KIND_LABEL[bot.artifactKind].toLowerCase()} read more like a draft than a final answer. The ${KIND_LABEL[top.artifactKind].toLowerCase()} showed you have it in you — let's run another shift this week.`
}
