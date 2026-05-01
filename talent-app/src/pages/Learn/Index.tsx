import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { showToast } from '../../components/Toast'
import type { LearnIndex } from '../../types'
import clsx from 'clsx'

/* The unified entry point that replaces the old separate /tutor + /assessments
 * pages. Everything is organised by cluster → subtopic. Click any subtopic to
 * drop into the 5-tab Subtopic page. */
export default function LearnIndexPage() {
  const navigate = useNavigate()

  // v3.1.10 — always-fresh: cross-portal updates land here on next visit
  const { data, isLoading } = useQuery<LearnIndex>({
    queryKey: ['learn-index'],
    queryFn:  () => apiFetch('/api/talent/me/learn'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    onError:  (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  if (isLoading) return <div className="text-slate text-sm p-4">Loading your learning paths…</div>
  if (!data)     return <div className="text-red-600 text-sm p-4">Couldn't load.</div>

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Learn</h1>
          <p className="text-xs text-slate mt-0.5">
            Visual concept primers + AI tutor + graded practice + capstone application — all in one place, organised by cluster.
            {data.learnerTrack && <> Subtopics relevant to <strong className="text-accent">{data.learnerTrack}</strong> are highlighted.</>}
          </p>
        </div>
        {data.unlockThresholdPct !== undefined && (
          <div className="text-[10px] text-slate text-right flex-shrink-0">
            <div className="font-semibold uppercase tracking-wider mb-0.5">Unlock rule</div>
            <div>Reach <strong className="text-navy">{data.unlockThresholdPct}%</strong> mastery to unlock the next sub-topic in a cluster.</div>
          </div>
        )}
      </div>

      {/* Recommended next */}
      {data.recommended && (
        <div className="bg-gradient-to-r from-accent/10 to-gold/10 border border-accent/30 rounded-md p-5 mb-6">
          <div className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-1">Recommended next</div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-navy mb-0.5">{data.recommended.name}</h2>
              <p className="text-xs text-slate">
                <span className="font-semibold">{data.recommended.cluster}</span> — your weakest cluster. Start here for the highest mastery gain per minute.
              </p>
            </div>
            <button
              onClick={() => navigate(`/learn/${data.recommended!.cluster}/${data.recommended!.subtopic}`)}
              className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors flex-shrink-0"
            >
              Start learning →
            </button>
          </div>
        </div>
      )}

      {/* Cluster groups */}
      <div className="flex flex-col gap-4">
        {data.clusters.map(cl => (
          <div key={cl.clusterCode} className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
            {/* Cluster header */}
            <div className="px-5 py-4 border-b border-rule flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-accent-light text-accent">{cl.clusterCode}</span>
                <div>
                  <div className="text-sm font-semibold text-navy">{clusterName(cl.clusterCode)}</div>
                  <div className="text-[10px] text-slate">
                    {cl.subtopics.length} sub-topics · {cl.subtopics.filter(s => s.authored).length} with full content
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[9px] font-semibold text-slate uppercase tracking-wide">Your score</div>
                  <div className={clsx(
                    'text-base font-bold leading-none',
                    cl.score >= 70 ? 'text-green-700' : cl.score >= 55 ? 'text-amber-600' : 'text-red-600'
                  )}>{cl.score}</div>
                </div>
                <div className="w-24 h-1.5 bg-cloud rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full',
                    cl.score >= 70 ? 'bg-green-700' : cl.score >= 55 ? 'bg-amber-500' : 'bg-red-600'
                  )} style={{ width: `${cl.score}%` }} />
                </div>
              </div>
            </div>

            {/* Subtopics */}
            <div className="divide-y divide-rule">
              {/* v3.1 — sort within cluster: relevant-to-track first, then by code order.
                  Lock state stays visually distinct; clicking a locked sub-topic shows
                  a tooltip but doesn't navigate. */}
              {[...cl.subtopics].sort((a, b) => {
                if (a.relevant !== b.relevant) return a.relevant ? -1 : 1
                return 0
              }).map(s => {
                const isRecommended = data.recommended?.subtopic === s.code
                const locked = s.unlocked === false
                return (
                  <button
                    key={s.code}
                    onClick={() => { if (!locked) navigate(`/learn/${cl.clusterCode}/${s.code}`) }}
                    disabled={locked}
                    title={locked ? s.lockReason : undefined}
                    className={clsx(
                      'w-full px-5 py-3 flex items-center justify-between text-left transition-colors',
                      locked && 'opacity-50 cursor-not-allowed',
                      !locked && isRecommended && 'bg-accent/5 hover:bg-accent/10',
                      !locked && !isRecommended && 'hover:bg-cloud/40'
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={clsx(
                        'text-base flex-shrink-0',
                        locked ? 'text-slate/40' : (s.authored ? 'text-accent' : 'text-slate/40')
                      )}>
                        {locked ? '🔒' : (s.authored ? '◉' : '○')}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-navy truncate">{s.name}</span>
                          {isRecommended && !locked && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gold/20 text-amber-700 flex-shrink-0">RECOMMENDED</span>
                          )}
                          {s.relevant && data.learnerTrack && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-accent/10 text-accent flex-shrink-0">For {data.learnerTrack}</span>
                          )}
                          {!s.required && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate/10 text-slate flex-shrink-0">OPTIONAL</span>
                          )}
                          {locked && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 flex-shrink-0">LOCKED</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate font-mono mt-0.5">
                          {s.code} · {s.practiceCount} practice items{!s.authored && ' · concept content coming'} · mastery {Math.round(s.mastery * 100)}%
                        </div>
                        {locked && s.lockReason && (
                          <div className="text-[10px] text-amber-700 mt-0.5">{s.lockReason}</div>
                        )}
                      </div>
                    </div>
                    <span className="text-slate text-sm flex-shrink-0">{locked ? '🔒' : '→'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CLUSTER_NAMES: Record<string, string> = {
  C1: 'Core Tech',
  C2: 'Applied Problem Solving',
  C3: 'Engineering Execution',
  C4: 'System & Product Thinking',
  C5: 'Communication & Collaboration',
  C6: 'Domain Specialisation',
  C7: 'Ownership & Judgment',
  C8: 'Learning Agility',
}
function clusterName(code: string): string { return CLUSTER_NAMES[code] ?? code }
