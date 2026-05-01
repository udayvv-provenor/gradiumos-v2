const CLUSTERS = ['C1','C2','C3','C4','C5','C6','C7','C8'] as const
function band(s: number) { return s >= 70 ? 'above' : s >= 55 ? 'near' : 'below' }

/** Confidence pill: collapses 0..1 decimals into HIGH / MED / LOW pills. */
function confLabel(n: number): { label: 'HIGH' | 'MED' | 'LOW'; cls: string } {
  if (n >= 0.7) return { label: 'HIGH', cls: 'bg-green-50 text-green-700 border-green-200' }
  if (n >= 0.4) return { label: 'MED',  cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  return            { label: 'LOW',  cls: 'bg-slate-50 text-slate-600 border-slate-200' }
}

interface ClusterRow { id: string; name?: string; score: number; confidence?: number }

export function ClusterBars({ clusters, showConfidence = false }: { clusters: ClusterRow[]; showConfidence?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {clusters.map(c => {
        const b = band(c.score)
        const barColor = b === 'above' ? 'bg-green-700' : b === 'near' ? 'bg-amber-500' : 'bg-red-600'
        return (
          <div key={c.id} className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate w-5 flex-shrink-0">{c.id}</span>
            {c.name && <span className="text-xs text-ink w-44 flex-shrink-0 truncate">{c.name}</span>}
            <div className="relative flex-1 h-2 bg-cloud rounded-full">
              <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${c.score}%` }} />
              <div className="absolute top-[-3px] h-[calc(100%+6px)] w-[2px] bg-navy opacity-20 rounded" style={{ left: '70%' }} />
            </div>
            <span className="text-[11px] font-bold text-ink w-6 text-right flex-shrink-0">{c.score}</span>
            {showConfidence && c.confidence !== undefined && (() => {
              const { label, cls } = confLabel(c.confidence)
              return (
                <span
                  title={`Confidence ${c.confidence.toFixed(2)} — derived from evidence count + recency`}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border w-12 text-center flex-shrink-0 ${cls}`}
                >{label}</span>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}
