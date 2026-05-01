import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { AssessmentQuestion, AttemptResult } from '../types'
import clsx from 'clsx'

export default function AssessmentTake() {
  const { bankItemId } = useParams<{ bankItemId: string }>()
  const navigate = useNavigate()
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [descriptiveAnswer, setDescriptiveAnswer] = useState('')
  const [result, setResult] = useState<AttemptResult | null>(null)

  const questionQ = useQuery<AssessmentQuestion>({
    queryKey: ['assessment-question', bankItemId],
    queryFn: () => apiFetch(`/api/talent/me/assessment-bank/${bankItemId!}`),
  } as any)

  const submitMut = useMutation<AttemptResult, Error, { answer: string }>({
    mutationFn: data => apiFetch(`/api/talent/me/assessments/${bankItemId!}/attempt`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: r => setResult(r),
    onError: e => showToast(e.message),
  })

  const q = questionQ.data

  function handleSubmit() {
    if (!q) return
    const answer = q.type === 'MCQ' ? selectedOption ?? '' : descriptiveAnswer.trim()
    if (!answer) { showToast('Please provide an answer before submitting'); return }
    submitMut.mutate({ answer })
  }

  if (questionQ.isLoading) return <div className="text-slate text-sm p-4">Loading question…</div>
  if (!q) return <div className="text-red-600 text-sm p-4">Question not found.</div>

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <button onClick={() => navigate('/assessments')} className="text-slate hover:text-navy transition-colors">← Assessments</button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{q.cluster} · {q.clusterName}</span>
      </div>

      <div className="bg-white rounded-md border border-rule shadow-card p-6 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent-light text-accent">{q.cluster}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cloud text-slate">{q.type}</span>
        </div>
        <h2 className="text-base font-semibold text-navy leading-relaxed mb-5">{q.questionText}</h2>

        {/* MCQ */}
        {q.type === 'MCQ' && q.options && !result && (
          <div className="flex flex-col gap-2">
            {q.options.map(opt => (
              <button
                key={opt.id}
                onClick={() => setSelectedOption(opt.id)}
                className={clsx(
                  'text-left px-4 py-3 rounded-md border-2 text-sm transition-all',
                  selectedOption === opt.id
                    ? 'border-accent bg-accent-light text-navy font-medium'
                    : 'border-rule bg-white text-ink hover:border-accent/40'
                )}
              >
                {opt.text}
              </button>
            ))}
          </div>
        )}

        {/* MCQ Result */}
        {q.type === 'MCQ' && result && q.options && (
          <div className="flex flex-col gap-2">
            {q.options.map(opt => {
              const isCorrect = opt.id === result.correctOptionId
              const isSelected = opt.id === selectedOption
              return (
                <div
                  key={opt.id}
                  className={clsx(
                    'px-4 py-3 rounded-md border-2 text-sm',
                    isCorrect ? 'border-green-500 bg-green-50 text-green-800 font-medium'
                      : isSelected ? 'border-red-400 bg-red-50 text-red-700'
                      : 'border-rule bg-white text-ink opacity-60'
                  )}
                >
                  {opt.text}
                  {isCorrect && <span className="ml-2 text-[10px] font-bold text-green-700">✓ Correct</span>}
                  {isSelected && !isCorrect && <span className="ml-2 text-[10px] font-bold text-red-600">✗ Your answer</span>}
                </div>
              )
            })}
            <div className={clsx('mt-3 px-4 py-3 rounded-md text-sm font-semibold', result.correct ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>
              {result.correct ? '✓ Correct! ' : '✗ Incorrect. '} Score: {result.score}%
            </div>
          </div>
        )}

        {/* Descriptive */}
        {q.type === 'Descriptive' && !result && (
          <textarea
            value={descriptiveAnswer}
            onChange={e => setDescriptiveAnswer(e.target.value)}
            rows={8}
            placeholder="Write your answer here…"
            className="w-full text-sm px-3 py-2.5 border border-rule rounded focus:outline-none focus:border-accent transition-colors resize-y"
          />
        )}

        {/* Descriptive Result */}
        {q.type === 'Descriptive' && result && (
          <div className="flex flex-col gap-4">
            <div className="bg-cloud rounded-md p-4">
              <div className="text-xs font-semibold text-slate mb-2">Your Answer</div>
              <p className="text-sm text-ink whitespace-pre-wrap">{descriptiveAnswer}</p>
            </div>
            <div className="bg-white border border-rule rounded-md p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-navy">AI Evaluation</span>
                <span className="text-lg font-bold text-accent">{result.score}%</span>
              </div>
              {result.feedback && (
                <div className="flex flex-col gap-3">
                  {result.feedback.strengths.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-green-700 uppercase tracking-wide mb-1.5">Strengths</div>
                      <ul className="flex flex-col gap-1">{result.feedback.strengths.map((s, i) => <li key={i} className="text-xs text-ink flex gap-1.5"><span className="text-green-600 flex-shrink-0">·</span>{s}</li>)}</ul>
                    </div>
                  )}
                  {result.feedback.gaps.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-red-600 uppercase tracking-wide mb-1.5">Gaps</div>
                      <ul className="flex flex-col gap-1">{result.feedback.gaps.map((g, i) => <li key={i} className="text-xs text-ink flex gap-1.5"><span className="text-red-500 flex-shrink-0">·</span>{g}</li>)}</ul>
                    </div>
                  )}
                  {result.feedback.suggestions.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-accent uppercase tracking-wide mb-1.5">Suggestions</div>
                      <ul className="flex flex-col gap-1">{result.feedback.suggestions.map((s, i) => <li key={i} className="text-xs text-ink flex gap-1.5"><span className="text-accent flex-shrink-0">·</span>{s}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {!result ? (
        <div className="flex gap-2">
          <button onClick={() => navigate('/assessments')} className="px-4 py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors">Cancel</button>
          {submitMut.isPending ? (
            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-accent-light rounded text-accent text-sm font-medium">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              {q.type === 'Descriptive' ? 'AI grading…' : 'Submitting…'}
            </div>
          ) : (
            <button onClick={handleSubmit} className="flex-1 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">Submit answer →</button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => navigate('/assessments')} className="flex-1 py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors">← Back to assessments</button>
          <button onClick={() => { setResult(null); setSelectedOption(null); setDescriptiveAnswer('') }} className="flex-1 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">Retry</button>
        </div>
      )}
    </div>
  )
}
