import clsx from 'clsx'

const CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const

function band(score: number) {
  if (score >= 70) return 'above'
  if (score >= 55) return 'near'
  return 'below'
}

function barColor(score: number) {
  const b = band(score)
  if (b === 'above') return 'bg-green-700'
  if (b === 'near') return 'bg-amber-500'
  return 'bg-red-600'
}

function badgeClass(score: number) {
  const b = band(score)
  if (b === 'above') return 'bg-green-100 text-green-800'
  if (b === 'near') return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-800'
}

function badgeLabel(score: number) {
  const b = band(score)
  if (b === 'above') return 'Above'
  if (b === 'near') return 'Near'
  return 'Below'
}

interface Props {
  scores: Record<string, number>
  threshold?: number
}

export function ClusterBars({ scores, threshold = 70 }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {CLUSTERS.map(c => {
        const score = scores[c] ?? 0
        return (
          <div key={c} className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate w-5 flex-shrink-0">{c}</span>
            <div className="relative flex-1 h-[7px] bg-cloud rounded-full overflow-visible">
              <div
                className={clsx('h-full rounded-full transition-all duration-700', barColor(score))}
                style={{ width: `${score}%` }}
              />
              <div
                className="absolute top-[-3px] h-[calc(100%+6px)] w-[2px] bg-navy opacity-20 rounded"
                style={{ left: `${threshold}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-ink w-6 text-right flex-shrink-0">{score}</span>
            <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded-full w-12 text-center flex-shrink-0', badgeClass(score))}>
              {badgeLabel(score)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
