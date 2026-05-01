import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { GapReport } from '../types'
import clsx from 'clsx'
import { RadarChart } from '../components/RadarChart'

/* GapReport — the Dean's view of "where does our curriculum stand vs.
 * what employers actually demand on this career track". This page makes
 * the architecture's value-prop visible:
 *   - Aggregated demand (what employers want, seat-weighted, recency-decayed)
 *   - Curriculum coverage (what we currently teach)
 *   - The gap (what AI-augmentation has to fill in the meantime)
 *   - Subjects most responsible for gaps (where to add hours)
 *   - AI-generated augmentation recommendations (specific interventions) */

export default function GapReport() {
  const { careerTrackId } = useParams<{ careerTrackId: string }>()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<GapReport>({
    queryKey: ['gap-report', careerTrackId],
    queryFn: () => apiFetch(`/api/campus/career-tracks/${careerTrackId!}/gap-report`),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  if (isLoading) return <div className="text-slate text-sm p-4">Computing gap report…</div>
  if (!data)     return <div className="text-red-600 text-sm p-4">Couldn't load.</div>

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-sm">
        <button onClick={() => navigate('/career-tracks')} className="text-slate hover:text-navy">← Career Tracks</button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{data.careerTrackName} gap report</span>
      </div>

      {/* Header */}
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy">{data.careerTrackName} — Gap Analysis</h1>
          <p className="text-xs text-slate mt-0.5">
            Where your curriculum stands vs. aggregated employer demand on this track. Demand is computed from {data.demand.sampleSize} active role{data.demand.sampleSize === 1 ? '' : 's'} ({data.demand.totalSeats} total seats), seat-weighted and recency-decayed.
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider">Overall readiness</div>
          <div className={clsx('text-2xl font-bold leading-none',
            data.overallReadiness >= 75 ? 'text-green-700' : data.overallReadiness >= 55 ? 'text-amber-600' : 'text-red-600'
          )}>{data.overallReadiness}%</div>
        </div>
      </div>

      {/* No-data banners */}
      {data.curriculumId === null && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border-l-[3px] border-amber-500 rounded text-xs text-amber-900">
          <strong>No curriculum uploaded yet.</strong> Upload a curriculum on the Career Tracks &gt; Curriculum tab to populate the "your curriculum" side of this comparison. Until then, all gaps appear as "we cover 0%".
        </div>
      )}
      {data.demand.sampleSize === 0 && (
        <div className="mb-4 px-4 py-3 bg-slate-50 border-l-[3px] border-slate rounded text-xs text-slate">
          <strong>No employer demand data yet for this track.</strong> Employers haven't uploaded JDs to this career track. Aggregated demand shows zeros until data flows in.
        </div>
      )}

      {/* Spider/radar — v3.1.4 the headline visual: curriculum vs demand at a glance.
       * If the two polygons overlap closely, the curriculum is well-aligned. Where
       * the demand (amber) sticks out beyond the curriculum (violet), that's the gap. */}
      <div className="bg-white border border-rule rounded-md shadow-card mb-5 p-5">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-navy">Curriculum vs employer demand — competency shape</h2>
            <p className="text-[10px] text-slate mt-0.5">Where amber (demand) sticks out beyond violet (curriculum), that's a real gap. Same shape = aligned.</p>
          </div>
        </div>
        <div className="flex justify-center">
          <RadarChart
            size={420}
            series={[
              { label: 'Curriculum coverage', color: 'violet', values: data.perCluster.map(g => g.curriculumPct) },
              { label: 'Aggregated demand',   color: 'amber',  values: data.perCluster.map(g => g.demandPct) },
            ]}
          />
        </div>
      </div>

      {/* Cluster gap bars — v3.1.1 visual cleanup: removed per-row borders,
       * header row no longer separated by line; just typographic hierarchy +
       * generous row padding so the table breathes. */}
      <div className="bg-white border border-rule rounded-md shadow-card mb-5 p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold text-navy">Per-cluster comparison</h2>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-500" /><span className="text-violet-700 font-semibold">Your curriculum</span></span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-amber-700 font-semibold">Aggregated demand</span></span>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {data.perCluster.map(g => (
            <div key={g.clusterCode} className="grid grid-cols-12 items-center gap-4">
              <div className="col-span-3 flex items-baseline gap-2 min-w-0">
                <span className="text-[10px] font-bold text-slate w-5 flex-shrink-0">{g.clusterCode}</span>
                <span className="text-xs font-semibold text-navy truncate">{g.clusterName}</span>
              </div>
              <div className="col-span-7 grid grid-cols-2 gap-3">
                <DualBar value={g.curriculumPct} color="violet" />
                <DualBar value={g.demandPct} color="amber" />
              </div>
              <div className="col-span-2 flex justify-end">
                <SeverityChip severity={g.severity} gap={g.gapPct} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Side-by-side: subjects + AI augmentations. v3.1.1: equal-height cards
       * via items-stretch on the grid, no inner-row borders on subjects, more
       * breathing room. */}
      <div className="grid grid-cols-2 gap-5 items-stretch">
        {/* Subjects — v3.1.1: shows coverage AND linked-cluster demand side-by-side,
         * cluster pills inline, and replaces opaque "impact 0" numbers with a
         * priority pill (HIGH / MED / LOW) plus a tooltip-explainer footer. */}
        <div className="bg-white border border-rule rounded-md shadow-card p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-navy mb-1">Subjects that most contribute to the gaps</h2>
          <p className="text-[10px] text-slate mb-4 leading-snug">Subjects whose low coverage hits high-demand clusters. Adding hours here moves the readiness number fastest.</p>
          {data.topGapSubjects.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-8 text-center text-slate text-xs italic">No gap-contributing subjects identified — either no curriculum loaded or no critical/moderate gaps.</div>
          ) : (
            <div className="flex flex-col gap-3 flex-1">
              {data.topGapSubjects.map((s, i) => {
                // Compute demand for THIS subject = avg demand across linked clusters
                const avgDemand = (() => {
                  const ds = s.clusters.map(c => data.perCluster.find(p => p.clusterCode === c)?.demandPct ?? 0)
                  return ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : 0
                })()
                // Impact priority bucket — converts opaque 0..1 number to readable pill.
                // Threshold: < 0.05 → LOW (small effect), 0.05–0.12 → MED, > 0.12 → HIGH.
                const impact = s.gapImpact
                const priority: 'HIGH'|'MED'|'LOW' = impact >= 0.12 ? 'HIGH' : impact >= 0.05 ? 'MED' : 'LOW'
                const priorityCls = priority === 'HIGH' ? 'bg-red-100 text-red-700' : priority === 'MED' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                return (
                  <div key={i} className="flex items-center justify-between gap-3 py-2 border-b border-rule/40 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[12.5px] font-medium text-navy">{s.name}</div>
                        <div className="flex gap-1 flex-nowrap">
                          {s.clusters.map(c => (
                            <span key={c} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cloud text-slate">{c}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[10px] text-slate mt-1 flex items-center gap-3">
                        <span><span className="text-violet-700 font-semibold">{s.coveragePct}%</span> cov</span>
                        <span className="text-slate/60">vs</span>
                        <span><span className="text-amber-700 font-semibold">{avgDemand}%</span> demand</span>
                      </div>
                    </div>
                    <span
                      title={`Impact ${impact.toFixed(2)} — fixing this subject moves the overall-readiness number by ~${Math.round(impact * 100)}%`}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 cursor-help ${priorityCls}`}
                    >{priority} priority</span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-[9px] text-slate/70 mt-3 italic">
            <strong>Priority</strong> = how much fixing this subject's gap moves the overall-readiness number. HIGH ≥12%, MED 5–12%, LOW &lt;5%.
          </p>
        </div>

        {/* AI augmentations */}
        <div className="bg-gradient-to-br from-accent/5 to-gold/5 border border-accent/20 rounded-md p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-navy">AI-suggested augmentations</h2>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent/20 text-accent">{data.augmentations.length}</span>
          </div>
          <p className="text-[10px] text-slate mb-4 leading-snug">Specific interventions to close the critical/moderate gaps. Effort tags reflect institutional resourcing.</p>
          <div className="flex flex-col gap-3 flex-1">
            {data.augmentations.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center text-slate text-xs italic py-8">No augmentations needed — all clusters are on-track.</div>
            )}
            {data.augmentations.map((a, i) => (
              <div key={i} className="bg-white border border-rule rounded p-3.5">
                <div className="flex items-baseline justify-between mb-1.5 gap-2">
                  <span className="text-[12.5px] font-bold text-navy">{a.area}</span>
                  <EffortChip effort={a.effort} />
                </div>
                <div className="text-[11px] text-slate italic mb-2 leading-relaxed">{a.currentState}</div>
                <div className="text-[12.5px] text-ink leading-relaxed mb-2">{a.recommendation}</div>
                <div className="text-[10.5px] text-accent leading-relaxed pt-2 border-t border-rule/60">
                  <strong className="text-accent uppercase tracking-wider mr-1">First step:</strong> {a.exampleAction}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Demand provenance */}
      {data.demand.topEmployers.length > 0 && (
        <div className="mt-5 bg-white border border-rule rounded-md shadow-card p-4">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Demand source — top employers contributing</div>
          <div className="flex gap-2 flex-wrap">
            {data.demand.topEmployers.map(e => (
              <span key={e.name} className="text-[11px] px-2 py-1 rounded bg-cloud border border-rule">
                <strong className="text-navy">{e.name}</strong> <span className="text-slate">— {e.roleCount} role{e.roleCount === 1 ? '' : 's'}, {e.seatTotal} seat{e.seatTotal === 1 ? '' : 's'}</span>
              </span>
            ))}
          </div>
          <div className="text-[9px] text-slate mt-2">
            Recency-decayed (180-day halflife) and seat-weighted. Updates as employers post / refresh JDs.
          </div>
        </div>
      )}
    </div>
  )
}

function DualBar({ value, color }: { value: number; color: 'violet'|'amber' }) {
  const c = color === 'violet' ? 'bg-violet-600' : 'bg-amber-500'
  const bg = color === 'violet' ? 'bg-violet-100' : 'bg-amber-100'
  const tx = color === 'violet' ? 'text-violet-700' : 'text-amber-700'
  return (
    <div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className={clsx('text-[13px] font-bold leading-none', tx)}>{value}</span>
        <span className="text-[8px] text-slate">/100</span>
      </div>
      <div className={clsx('h-1.5 rounded-full overflow-hidden', bg)}>
        <div className={clsx('h-full rounded-full', c)} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function SeverityChip({ severity, gap }: { severity: 'critical'|'moderate'|'minor'|'none'; gap: number }) {
  const map = {
    critical: 'bg-red-100 text-red-800',
    moderate: 'bg-amber-100 text-amber-800',
    minor:    'bg-slate-100 text-slate-700',
    none:     'bg-green-100 text-green-800',
  }
  return (
    <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider', map[severity])}>
      {severity === 'none' ? '✓ on track' : `${severity} (${gap})`}
    </span>
  )
}

function EffortChip({ effort }: { effort: 'low'|'medium'|'high' }) {
  const map = { low: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', high: 'bg-red-100 text-red-700' }
  return <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', map[effort])}>{effort} effort</span>
}
