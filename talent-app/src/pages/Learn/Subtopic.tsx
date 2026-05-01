import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import { showToast } from '../../components/Toast'
import type { SubtopicPayload } from '../../types'
import clsx from 'clsx'
import ConceptTab from './tabs/ConceptTab'
import PracticeTab from './tabs/PracticeTab'
import ApplyTab from './tabs/ApplyTab'
import ProgressTab from './tabs/ProgressTab'
import LessonStream from './lesson/LessonStream'

type Tab = 'concept' | 'tutor' | 'practice' | 'apply' | 'progress'

const TABS: { key: Tab; label: string; icon: string; hint: string }[] = [
  { key: 'concept',  label: 'Concept',  icon: '◐', hint: 'Visual primer — read & understand' },
  { key: 'tutor',    label: 'Lesson',   icon: '◊', hint: 'Adaptive AI lesson stream' },
  { key: 'practice', label: 'Practice', icon: '✎', hint: 'Graded items from the bank' },
  { key: 'apply',    label: 'Apply',    icon: '★', hint: 'Work-simulation scenario — AI-graded' },
  { key: 'progress', label: 'Progress', icon: '◷', hint: 'Your attempts & mastery' },
]

export default function Subtopic() {
  const { cluster, subtopic } = useParams<{ cluster: string; subtopic: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('concept')

  const { data, isLoading, refetch } = useQuery<SubtopicPayload>({
    queryKey: ['learn-subtopic', subtopic],
    queryFn: () => apiFetch(`/api/talent/me/learn/${subtopic!}`),
    enabled: !!subtopic,
  } as any)

  if (isLoading) return <div className="text-slate text-sm p-4">Loading {subtopic}…</div>
  if (!data)     return <div className="text-red-600 text-sm p-4">Subtopic not found.</div>

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        <button onClick={() => navigate('/learn')} className="text-slate hover:text-navy transition-colors">← Learn</button>
        <span className="text-slate">/</span>
        <span className="text-slate">{cluster}</span>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{data.subtopic.name}</span>
      </div>

      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent-light text-accent">{data.subtopic.clusterCode}</span>
            <h1 className="text-[20px] font-bold text-navy leading-tight">{data.concept.title}</h1>
            {!data.concept.authored && (
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">PREVIEW</span>
            )}
          </div>
          <p className="text-xs text-slate">{data.concept.subtitle}</p>
        </div>
        {/* Mastery snapshot */}
        <div className="flex-shrink-0 bg-white border border-rule rounded-md px-4 py-2.5 min-w-[140px]">
          <div className="text-[9px] font-semibold text-slate uppercase tracking-wide mb-0.5">Your mastery</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-navy">{Math.round(data.progress.mastery * 100)}%</span>
            <span className="text-[10px] text-slate">/ 100</span>
          </div>
          <div className="mt-1.5 h-1 bg-cloud rounded-full overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all duration-700',
                data.progress.mastery >= 0.7 ? 'bg-green-700' :
                data.progress.mastery >= 0.55 ? 'bg-amber-500' : 'bg-red-600'
              )}
              style={{ width: `${data.progress.mastery * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-rule mb-5 gap-0">
        {TABS.map(t => {
          const isActive = tab === t.key
          const isDisabled = t.key === 'apply' && !data.apply
          return (
            <button
              key={t.key}
              onClick={() => !isDisabled && setTab(t.key)}
              disabled={isDisabled}
              className={clsx(
                'group relative px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-1.5',
                isActive
                  ? 'border-accent text-accent'
                  : isDisabled
                    ? 'border-transparent text-slate/40 cursor-not-allowed'
                    : 'border-transparent text-slate hover:text-navy'
              )}
            >
              <span>{t.icon}</span>
              {t.label}
              {isDisabled && <span className="text-[9px] font-bold ml-1 px-1 py-0.5 rounded bg-slate/10 text-slate">SOON</span>}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'concept'  && <ConceptTab concept={data.concept} />}
        {tab === 'tutor'    && <LessonStream subtopic={data.subtopic} concept={data.concept} onLessonComplete={refetch} />}
        {tab === 'practice' && <PracticeTab items={data.practice} subtopicCode={data.subtopic.code} />}
        {tab === 'apply'    && <ApplyTab subtopicCode={data.subtopic.code} subtopicName={data.subtopic.name} />}
        {tab === 'progress' && <ProgressTab progress={data.progress} subtopicName={data.subtopic.name} />}
      </div>
    </div>
  )
}
