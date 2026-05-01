import clsx from 'clsx'

/* MarketIntelPanel — renders ONE slot of market intel (any of self-profile,
 * peer-benchmark, counterparty, domain-news). Same component shape across
 * all 3 portals — copy this file to workforce-app + campus-app.
 *
 * Two display modes:
 *  - MarketSnapshot shape: { headline, facts[], topEntities[], emptyState }
 *  - PeerBenchmark shape:  { benchmark, comparison?, sources[], emptyState }
 *
 * Empty state is rendered honestly — never "fake-populated". */

export interface MarketSnapshot {
  headline: string
  facts: { claim: string; source: string; retrievedAt: string; url?: string }[]
  topEntities: { name: string; type: string; metric: string }[]
  emptyState: boolean
  emptyStateReason?: string
}

export interface PeerBenchmark {
  benchmark: { metric: string; value: string; context: string }
  comparison?: { userValue?: string; delta?: string }
  sources: { source: string; retrievedAt: string; url?: string }[]
  emptyState: boolean
  emptyStateReason?: string
}

interface Props {
  title: string
  subtitle?: string
  data: MarketSnapshot | PeerBenchmark
  accent?: 'teal' | 'violet' | 'amber' | 'navy' | 'gold'
  onRefresh?: () => void
  isRefreshing?: boolean
}

const ACCENT_CLASSES: Record<string, string> = {
  teal:   'border-l-accent text-accent',
  violet: 'border-l-violet-500 text-violet-700',
  amber:  'border-l-amber-500 text-amber-700',
  navy:   'border-l-navy text-navy',
  gold:   'border-l-gold text-amber-700',
}

export function MarketIntelPanel({ title, subtitle, data, accent = 'teal', onRefresh, isRefreshing }: Props) {
  const isPeer = 'benchmark' in data
  const accentCls = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.teal

  return (
    <div className={clsx('bg-white border border-rule rounded-md shadow-card border-l-[4px] overflow-hidden', accentCls.split(' ')[0])}>
      <div className="px-5 py-3 border-b border-rule flex items-start justify-between gap-3">
        <div>
          <div className={clsx('text-[10px] font-bold uppercase tracking-wider', accentCls.split(' ')[1])}>{title}</div>
          {subtitle && <div className="text-[11px] text-slate mt-0.5">{subtitle}</div>}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-[10px] font-semibold text-slate hover:text-navy transition-colors disabled:opacity-40"
          >
            {isRefreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
        )}
      </div>

      <div className="p-5">
        {data.emptyState ? (
          <EmptyState reason={data.emptyStateReason} />
        ) : isPeer ? (
          <PeerBenchmarkBody data={data as PeerBenchmark} />
        ) : (
          <SnapshotBody data={data as MarketSnapshot} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ reason }: { reason?: string }) {
  return (
    <div className="text-center py-6">
      <div className="text-2xl text-slate/30 mb-2">○</div>
      <div className="text-xs text-slate font-medium mb-1">No data available</div>
      {reason && <p className="text-[11px] text-slate/70 max-w-md mx-auto leading-relaxed">{reason}</p>}
    </div>
  )
}

function SnapshotBody({ data }: { data: MarketSnapshot }) {
  return (
    <>
      <p className="text-sm text-ink leading-relaxed mb-4 font-medium">{data.headline}</p>

      {data.topEntities.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-2">Top {data.topEntities[0]?.type === 'employer' ? 'employers' : data.topEntities[0]?.type === 'institution' ? 'institutions' : 'entities'}</div>
          <div className="flex flex-col gap-1.5">
            {data.topEntities.slice(0, 5).map((e, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="font-medium text-navy">{e.name}</span>
                <span className="text-slate">{e.metric}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.facts.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-2">Sources</div>
          <ul className="flex flex-col gap-2">
            {data.facts.map((f, i) => (
              <li key={i} className="text-[11px] text-ink leading-relaxed pl-3 border-l-2 border-rule">
                <div>{f.claim}</div>
                <div className="text-[9px] text-slate mt-0.5 font-mono">
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                      {f.source} · {f.retrievedAt} ↗
                    </a>
                  ) : (
                    <span>{f.source} · {f.retrievedAt}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function PeerBenchmarkBody({ data }: { data: PeerBenchmark }) {
  return (
    <>
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">{data.benchmark.metric}</div>
        <div className="text-base font-bold text-navy mb-1">{data.benchmark.value}</div>
        <div className="text-[11px] text-slate leading-relaxed">{data.benchmark.context}</div>
      </div>

      {data.comparison && (data.comparison.userValue || data.comparison.delta) && (
        <div className="bg-cloud rounded p-3 mb-4">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1">You vs benchmark</div>
          {data.comparison.userValue && <div className="text-xs text-navy"><strong>Your value:</strong> {data.comparison.userValue}</div>}
          {data.comparison.delta && <div className="text-xs text-navy mt-0.5"><strong>Delta:</strong> {data.comparison.delta}</div>}
        </div>
      )}

      {data.sources.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider mb-1.5">Sources</div>
          <div className="flex gap-2 flex-wrap">
            {data.sources.map((s, i) => (
              <span key={i} className="text-[10px] font-mono text-slate bg-cloud border border-rule rounded px-2 py-0.5">
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent">{s.source} ↗</a> : s.source}
                {' · '}{s.retrievedAt}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
