/* ApplyTab — work-simulation scenario for the subtopic.
 *
 * v3.1.4 — replaces "COMING SOON" with a real AI-generated scenario.
 * Per Uday's NOT-TEACHING-NOT-LEARNING work-simulation paradigm: place the
 * learner in a fictional company role, hand them a real artifact (PR diff,
 * Slack thread, prod log), ask for a concrete deliverable, AI-grade the
 * response against the scenario's rubric.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiFetch } from '../../../lib/api'
import { showToast } from '../../../components/Toast'
import clsx from 'clsx'

interface ApplyScenario {
  scenarioTitle: string
  roleContext: string
  situation: string
  artifact: { label: string; body: string }
  task: string
  rubric: { criterion: string; weight: number }[]
  estimatedMinutes: number
}

interface GradedResponse {
  graded: {
    score: number
    rubricScore: Record<string, number>
    strengths: string[]
    gaps: string[]
    suggestions: string[]
    oneLine: string
  }
  meta: { latencyMs: number; tokens: number; model: string }
}

export default function ApplyTab({ subtopicCode, subtopicName }: { subtopicCode: string; subtopicName: string }) {
  const [response, setResponse] = useState('')
  const [submitted, setSubmitted] = useState<GradedResponse | null>(null)

  const queryResult = useQuery({
    queryKey: ['learn-apply', subtopicCode],
    queryFn: () => apiFetch<{ scenario: ApplyScenario; cached: boolean }>(`/api/talent/me/learn/${subtopicCode}/apply`),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0]) as { data: { scenario: ApplyScenario; cached: boolean } | undefined; isLoading: boolean; error: Error | null }
  const { data, isLoading, error } = queryResult

  const gradeMut = useMutation<GradedResponse, Error, void>({
    mutationFn: () =>
      apiFetch(`/api/talent/me/learn/${subtopicCode}/apply/grade`, {
        method: 'POST',
        body: JSON.stringify({
          response,
          task:   data!.scenario.task,
          rubric: data!.scenario.rubric,
        }),
      }),
    onSuccess: (g) => {
      setSubmitted(g)
      showToast('Graded! Scroll to see feedback.', 'success')
    },
    onError: (e) => showToast(e.message),
  })

  if (isLoading) {
    return (
      <div className="bg-white border border-rule rounded-md shadow-card p-6">
        <div className="text-sm text-slate">Loading work-simulation scenario… (AI is composing a real-world situation for {subtopicName})</div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="bg-white border border-rule rounded-md shadow-card p-6">
        <div className="text-sm text-red-700">Could not load scenario. Try refreshing.</div>
      </div>
    )
  }

  const sc = data.scenario

  return (
    <div className="max-w-3xl space-y-4">
      {/* v3.1.5 — provenance pill */}
      <div>
        <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-800">AI-generated scenario · cluster-grounded · cached 30 days</span>
      </div>
      {/* Scenario header */}
      <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-md p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <div>
              <div className="text-[10px] font-bold tracking-wider text-amber-700 uppercase">Work simulation · not a quiz</div>
              <h3 className="text-base font-bold text-navy mt-0.5">{sc.scenarioTitle}</h3>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded bg-amber-100 text-amber-800 whitespace-nowrap">~{sc.estimatedMinutes} min</span>
        </div>
        <div className="mt-3 text-xs text-slate leading-relaxed">
          <strong className="text-navy">Your role:</strong> {sc.roleContext}
        </div>
      </div>

      {/* Situation */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5">
        <div className="text-[10px] font-bold tracking-wider text-slate uppercase mb-2">The situation</div>
        <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{sc.situation}</p>
      </div>

      {/* Artifact */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold tracking-wider text-accent uppercase">Artifact</span>
          <span className="text-[11px] font-semibold text-navy bg-cloud px-2 py-0.5 rounded">{sc.artifact.label}</span>
        </div>
        <pre className="bg-slate-50 border border-rule rounded p-4 text-[12px] text-ink leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto">{sc.artifact.body}</pre>
      </div>

      {/* Task + rubric */}
      <div className="bg-white border-2 border-accent/40 rounded-md shadow-card p-5">
        <div className="text-[10px] font-bold tracking-wider text-accent uppercase mb-2">Your deliverable</div>
        <p className="text-sm text-ink leading-relaxed mb-4 font-medium">{sc.task}</p>
        <div className="bg-cloud rounded p-3 mb-4">
          <div className="text-[10px] font-bold tracking-wider text-slate uppercase mb-2">Graded against</div>
          <ul className="space-y-1">
            {sc.rubric.map((r: { criterion: string; weight: number }) => (
              <li key={r.criterion} className="flex items-start gap-2 text-[11px] text-ink">
                <span className="font-mono text-accent shrink-0">[{Math.round(r.weight * 100)}%]</span>
                <span>{r.criterion}</span>
              </li>
            ))}
          </ul>
        </div>

        {!submitted ? (
          <>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Write your response here. Be specific. Reference the artifact."
              className="w-full min-h-[180px] border border-rule rounded p-3 text-sm font-mono leading-relaxed focus:outline-none focus:border-accent"
              disabled={gradeMut.isPending}
            />
            <div className="flex items-center justify-between mt-3">
              <div className="text-[10px] text-slate">{response.length} chars · min 10 to submit</div>
              <button
                onClick={() => gradeMut.mutate()}
                disabled={response.trim().length < 10 || gradeMut.isPending}
                className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-50"
              >
                {gradeMut.isPending ? 'AI grading…' : 'Submit for grading →'}
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => { setSubmitted(null); setResponse('') }}
            className="px-4 py-2 bg-cloud text-navy text-xs font-semibold rounded hover:bg-rule transition-colors"
          >
            ← Try again with a fresh response
          </button>
        )}
      </div>

      {/* Graded feedback */}
      {submitted && (
        <div className="bg-white border-2 border-green-300 rounded-md shadow-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={clsx(
                'text-3xl font-bold leading-none',
                submitted.graded.score >= 75 ? 'text-green-700' : submitted.graded.score >= 55 ? 'text-amber-600' : 'text-red-600',
              )}>{submitted.graded.score}</div>
              <div>
                <div className="text-[10px] font-bold tracking-wider text-slate uppercase">Overall score · 0-100</div>
                <div className="text-xs text-navy font-medium mt-0.5">{submitted.graded.oneLine}</div>
              </div>
            </div>
            <span className="text-[9px] text-slate font-mono">{submitted.meta.model}</span>
          </div>

          {/* Per-rubric breakdown */}
          <div>
            <div className="text-[10px] font-bold tracking-wider text-slate uppercase mb-2">Per-criterion</div>
            <div className="space-y-2">
              {Object.entries(submitted.graded.rubricScore).map(([criterion, sc]) => (
                <div key={criterion}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-ink truncate pr-2">{criterion}</span>
                    <span className={clsx('font-bold tabular-nums', sc >= 75 ? 'text-green-700' : sc >= 55 ? 'text-amber-600' : 'text-red-600')}>{sc}/100</span>
                  </div>
                  <div className="h-1.5 bg-cloud rounded-full overflow-hidden">
                    <div
                      className={clsx('h-full rounded-full transition-all', sc >= 75 ? 'bg-green-700' : sc >= 55 ? 'bg-amber-500' : 'bg-red-600')}
                      style={{ width: `${sc}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths / Gaps / Suggestions */}
          <div className="grid md:grid-cols-3 gap-3">
            {submitted.graded.strengths.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded p-3">
                <div className="text-[10px] font-bold tracking-wider text-green-800 uppercase mb-2">Strengths</div>
                <ul className="space-y-1">
                  {submitted.graded.strengths.map((s, i) => <li key={i} className="text-[11px] text-ink leading-relaxed">• {s}</li>)}
                </ul>
              </div>
            )}
            {submitted.graded.gaps.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3">
                <div className="text-[10px] font-bold tracking-wider text-amber-800 uppercase mb-2">Gaps</div>
                <ul className="space-y-1">
                  {submitted.graded.gaps.map((g, i) => <li key={i} className="text-[11px] text-ink leading-relaxed">• {g}</li>)}
                </ul>
              </div>
            )}
            {submitted.graded.suggestions.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <div className="text-[10px] font-bold tracking-wider text-blue-800 uppercase mb-2">Try next</div>
                <ul className="space-y-1">
                  {submitted.graded.suggestions.map((s, i) => <li key={i} className="text-[11px] text-ink leading-relaxed">• {s}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
