const CLUSTERS = ['C1','C2','C3','C4','C5','C6','C7','C8'] as const
function band(s: number) { return s >= 70 ? 'above' : s >= 55 ? 'near' : 'below' }
function barColor(s: number) { const b = band(s); return b === 'above' ? 'bg-green-700' : b === 'near' ? 'bg-amber-500' : 'bg-red-600' }
function badgeCls(s: number) { const b = band(s); return b === 'above' ? 'bg-green-100 text-green-800' : b === 'near' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800' }
function badgeLbl(s: number) { const b = band(s); return b === 'above' ? 'Above' : b === 'near' ? 'Near' : 'Below' }

export function ClusterBars({ scores, threshold = 70 }: { scores: Record<string, number>; threshold?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {CLUSTERS.map(c => {
        const s = scores[c] ?? 0
        return (
          <div key={c} className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate w-5 flex-shrink-0">{c}</span>
            <div className="relative flex-1 h-[7px] bg-cloud rounded-full">
              <div className={`h-full rounded-full transition-all duration-700 ${barColor(s)}`} style={{ width: `${s}%` }} />
              <div className="absolute top-[-3px] h-[calc(100%+6px)] w-[2px] bg-navy opacity-20 rounded" style={{ left: `${threshold}%` }} />
            </div>
            <span className="text-[11px] font-bold text-ink w-6 text-right flex-shrink-0">{s}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full w-12 text-center flex-shrink-0 ${badgeCls(s)}`}>{badgeLbl(s)}</span>
          </div>
        )
      })}
    </div>
  )
}
