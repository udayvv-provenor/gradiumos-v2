import { useNavigate } from 'react-router-dom'
import type { SubtopicPracticeItem } from '../../../types'
import clsx from 'clsx'

/* PracticeTab — list of graded items mapped to this subtopic.
 * Today these are filtered by clusterCode (every cluster has 6-12 items in
 * the bank). Clicking an item routes to the existing AssessmentTake page
 * which handles MCQ + Descriptive flows end-to-end and returns a score
 * with AI-graded feedback for descriptive items. */

const KIND_LABEL: Record<string, string> = {
  mcq: 'Multiple choice',
  descriptive: 'Descriptive',
  coding: 'Coding',
  simulation: 'Simulation',
}
const KIND_COLOR: Record<string, string> = {
  mcq:         'bg-blue-100 text-blue-800',
  descriptive: 'bg-violet-100 text-violet-800',
  coding:      'bg-amber-100 text-amber-800',
  simulation:  'bg-green-100 text-green-800',
}

export default function PracticeTab({ items, subtopicCode }: { items: SubtopicPracticeItem[]; subtopicCode: string }) {
  const navigate = useNavigate()

  if (items.length === 0) {
    return (
      <div className="bg-white border border-rule rounded-md p-10 text-center">
        <div className="text-3xl mb-3 opacity-30">✎</div>
        <div className="text-sm font-semibold text-navy mb-1">No practice items yet</div>
        <p className="text-xs text-slate">Practice items for this sub-topic land as the assessment bank expands.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 px-4 py-3 bg-accent-light/40 border-l-[3px] border-accent rounded">
        <p className="text-xs text-ink leading-relaxed">
          <strong className="text-navy">{items.length} practice items</strong> are mapped to this cluster. MCQs are auto-graded;
          descriptive items get AI-graded feedback (strengths / gaps / suggestions). Each attempt updates your CompetencyScore
          for {subtopicCode.split('.')[0]}.
        </p>
      </div>

      <div className="bg-white border border-rule rounded-md shadow-card overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {['Item', 'Kind', 'Time cap', ''].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="border-b border-rule last:border-0 hover:bg-cloud/40">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy">{it.title}</div>
                  <div className="font-mono text-[10px] text-slate mt-0.5">{it.id}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full', KIND_COLOR[it.kind])}>
                    {KIND_LABEL[it.kind] ?? it.kind}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate">{Math.floor(it.timeLimitSec / 60)}m {it.timeLimitSec % 60}s</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => navigate(`/assessments/${it.id}/take`)}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded bg-accent text-white hover:bg-accent-dark transition-colors"
                  >
                    Attempt →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
