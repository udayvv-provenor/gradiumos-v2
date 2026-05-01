import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { AssessmentBankItem } from '../types'
import clsx from 'clsx'

const CLUSTERS = ['All', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']
const TYPE_COLORS: Record<string, string> = { MCQ: 'bg-accent-light text-accent', Descriptive: 'bg-amber-100 text-amber-800' }
const DIFF_COLORS: Record<string, string> = { Easy: 'bg-green-100 text-green-800', Medium: 'bg-amber-100 text-amber-800', Hard: 'bg-red-100 text-red-800' }

export default function Assessments() {
  const navigate = useNavigate()
  const [activeCluster, setActiveCluster] = useState('All')

  const { data: bank = [], isLoading } = useQuery<AssessmentBankItem[]>({
    queryKey: ['assessment-bank'],
    queryFn: () => apiFetch('/api/talent/me/assessment-bank'),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const filtered = activeCluster === 'All' ? bank : bank.filter(i => i.cluster === activeCluster)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">Assessments</h1>
        <p className="text-xs text-slate mt-0.5">Build your competency signal — through a real work shift, or by drilling individual items</p>
      </div>

      {/* v3.1.5 — work-shift is the primary CTA. Not teaching, not learning —
       * the closest a learner can get to their first month on the job. */}
      <div className="mb-5 bg-gradient-to-br from-navy to-navy/85 rounded-md shadow-card overflow-hidden">
        <div className="p-6 text-white grid md:grid-cols-3 gap-4 items-center">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">⚡</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">25 min · AI-graded · Updates your dashboard</span>
            </div>
            <h2 className="text-lg font-bold mb-1">Take a work shift</h2>
            <p className="text-xs text-white/80 leading-relaxed">
              You're a junior engineer at a fictional company. 4 artifacts hit your inbox — a PR diff, a Slack from your manager, an incident log, a customer email. Handle them. AI grades against rubrics, not answer keys. Each submission feeds your CompetencyScore.
            </p>
          </div>
          <div className="flex md:justify-end">
            <button
              onClick={() => navigate('/shift')}
              className="px-5 py-3 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors w-full md:w-auto"
            >Start shift →</button>
          </div>
        </div>
      </div>

      {/* Secondary: individual-item drill */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-navy">Or drill individual items</h2>
        <button onClick={() => navigate('/learn')} className="text-[11px] text-accent hover:underline">Open Learn portal →</button>
      </div>

      {/* Cluster filter */}
      <div className="flex gap-2 flex-wrap mb-5">
        {CLUSTERS.map(c => (
          <button
            key={c}
            onClick={() => setActiveCluster(c)}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
              activeCluster === c
                ? 'bg-accent text-white border-accent'
                : 'bg-white text-slate border-rule hover:border-accent hover:text-accent'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {isLoading && <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">Loading assessment bank…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-10 text-center">
          <div className="text-3xl mb-3 opacity-30">✎</div>
          <div className="text-sm font-semibold text-navy mb-1">No assessments available</div>
          <p className="text-xs text-slate max-w-xs mx-auto">
            {activeCluster !== 'All' ? `No assessments found for ${activeCluster}. Try a different cluster.` : 'Your assessment bank is empty. Check back soon.'}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(item => (
            <div
              key={item.id}
              onClick={() => navigate(`/assessments/${item.id}/take`)}
              className="bg-white rounded-md border border-rule shadow-card p-4 cursor-pointer hover:border-accent/40 hover:shadow-hover transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold text-slate">{item.cluster}</span>
                    <span className="text-xs text-slate">·</span>
                    <span className="text-xs text-slate">{item.clusterName}</span>
                  </div>
                  <div className="text-sm font-semibold text-navy mb-2">{item.title}</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLORS[item.type]}`}>{item.type}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DIFF_COLORS[item.difficulty]}`}>{item.difficulty}</span>
                    {item.attempted && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">Attempted</span>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {item.lastScore !== undefined && (
                    <div className="text-lg font-bold text-accent">{item.lastScore}%</div>
                  )}
                  <button className="text-xs font-medium text-accent hover:underline mt-1">
                    {item.attempted ? 'Retry →' : 'Start →'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
