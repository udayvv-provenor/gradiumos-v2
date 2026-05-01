import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { ThreeWayMap, AugmentationPath } from '../types'
import clsx from 'clsx'
import { RadarChart } from '../components/RadarChart'

/* PathMap — the heart of the Talent experience. Per-cluster visualization
 * of three states: where you are (resume), where college will get you
 * (curriculum coverage), where employer demand sits. The space between
 * them is what AI fills.
 *
 * Below the map, the augmentation path: subtopics AI should teach you
 * NOW, split into:
 *  - Permanent gaps  → college won't cover; AI fills permanently
 *  - Bridge items    → college will eventually; AI bridges sooner
 *  - Reinforcement   → resume weakness in cluster college covers well
 *
 * This is the value prop made visible. */
export default function PathMap() {
  const { careerTrackId } = useParams<{ careerTrackId: string }>()
  const navigate = useNavigate()

  // v3.1.10 — always-fresh: cross-portal updates (Dean uploads curriculum,
  // Workforce posts JD) need to reflect immediately on next page visit.
  const mapQ = useQuery<ThreeWayMap>({
    queryKey: ['three-way-map', careerTrackId],
    queryFn: () => apiFetch(`/api/talent/me/three-way-map/${careerTrackId!}`),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const pathQ = useQuery<AugmentationPath>({
    queryKey: ['augmentation-path', careerTrackId],
    queryFn: () => apiFetch(`/api/talent/me/augmentation-path/${careerTrackId!}`),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  if (mapQ.isLoading) return <div className="text-slate text-sm p-4">Computing your path…</div>
  if (!mapQ.data)     return <div className="text-red-600 text-sm p-4">Couldn't load.</div>

  const map = mapQ.data
  const path = pathQ.data

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-sm">
        <button onClick={() => navigate('/profile')} className="text-slate hover:text-navy">← Profile</button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{map.careerTrackName} path</span>
      </div>

      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy">{map.careerTrackName}</h1>
          <p className="text-xs text-slate mt-0.5">Where you are · Where your college takes you · Where employer demand sits</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wider">Overall readiness</div>
          <div className={clsx('text-2xl font-bold leading-none',
            map.overallReadiness >= 75 ? 'text-green-700' : map.overallReadiness >= 55 ? 'text-amber-600' : 'text-red-600'
          )}>{map.overallReadiness}%</div>
        </div>
      </div>

      {/* Status banner if missing inputs */}
      {(!map.hasResume || !map.hasCurriculum) && (
        <div className="mb-5 px-4 py-3 bg-amber-50 border-l-[3px] border-amber-500 rounded text-xs text-amber-900 leading-relaxed">
          <strong className="text-amber-800">Partial data.</strong> {!map.hasResume && 'Upload your resume to populate the "current" state. '}{!map.hasCurriculum && 'Your institution hasn\'t uploaded a curriculum for this track yet — "college eventual" assumes 0 coverage. '}The map below shows what we have.
        </div>
      )}

      {/* v3.1.4 — 3-way spider/radar at the top: instantly shows the gaps the row table itemises below */}
      <div className="bg-white border border-rule rounded-md shadow-card mb-5 p-5">
        <div className="mb-2">
          <h2 className="text-sm font-semibold text-navy">3-way competency map</h2>
          <p className="text-[10px] text-slate mt-0.5">Where amber (demand) sticks out beyond blue (you), the gap is real today. Where amber sticks out beyond violet (college eventual) — that's a permanent gap your degree won't close.</p>
        </div>
        <div className="flex justify-center">
          <RadarChart
            size={420}
            series={[
              { label: 'You today',         color: 'blue',   values: map.rows.map((r: { current: number }) => r.current) },
              { label: 'College eventual',  color: 'violet', values: map.rows.map((r: { collegeEventual: number }) => r.collegeEventual) },
              { label: 'Employer demand',   color: 'amber',  values: map.rows.map((r: { demand: number }) => r.demand) },
            ]}
          />
        </div>
      </div>

      {/* The 3-way map */}
      <div className="bg-white border border-rule rounded-md shadow-card mb-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-rule grid grid-cols-12 items-center">
          <div className="col-span-3 text-[10px] font-bold text-slate uppercase tracking-wider">Cluster</div>
          <div className="col-span-7 grid grid-cols-3 gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">You today</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700">College eventual</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Demand</div>
          </div>
          <div className="col-span-2 text-[10px] font-bold text-slate uppercase tracking-wider text-right">Status</div>
        </div>

        {map.rows.map(row => (
          <div key={row.clusterCode} className="px-5 py-3 border-b border-rule last:border-0 grid grid-cols-12 items-center gap-2">
            <div className="col-span-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate w-6">{row.clusterCode}</span>
                <span className="text-xs font-semibold text-navy truncate">{row.clusterName}</span>
              </div>
            </div>

            {/* Three side-by-side bars */}
            <div className="col-span-7 grid grid-cols-3 gap-2">
              <ScoreBar value={row.current} color="blue" sub={`conf ${row.currentConfidence >= 0.7 ? 'HIGH' : row.currentConfidence >= 0.4 ? 'MED' : 'LOW'}`} />
              <ScoreBar value={row.collegeEventual} color="violet" sub="curriculum coverage" />
              <ScoreBar value={row.demand} color="amber" sub="aggregated demand" />
            </div>

            {/* Status pill */}
            <div className="col-span-2 text-right">
              {row.gapVsDemand <= 5 && row.demand > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">✓ On track</span>
              )}
              {row.gapVsDemand > 5 && row.permanentGap && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800" title="College won't close this gap">PERMANENT GAP</span>
              )}
              {row.gapVsDemand > 5 && !row.permanentGap && row.bridgeNeeded && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800" title="College will eventually cover, but you need it sooner">BRIDGE NEEDED</span>
              )}
              {row.gapVsDemand > 5 && !row.permanentGap && !row.bridgeNeeded && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">REINFORCE</span>
              )}
              {row.demand === 0 && (
                <span className="text-[10px] font-semibold text-slate">no demand data</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Augmentation path */}
      {path && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-sm font-bold text-navy">Your AI-augmentation path</h2>
            <span className="text-[11px] text-slate">~{path.totalEstimatedHours} hours of focused work</span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <PathColumn
              title="Permanent gaps"
              subtitle="College won't cover these. AI fills them in your learning portal."
              colorClass="border-l-red-500 bg-red-50/30"
              items={path.permanentGapItems}
              onPick={(code) => navigate(`/learn/${code.split('.')[0]}/${code}`)}
              emptyText="No permanent gaps detected — your college's curriculum maps well to demand."
            />
            <PathColumn
              title="Bridge items"
              subtitle="College will eventually teach these — AI bridges them now so you're ready sooner."
              colorClass="border-l-blue-500 bg-blue-50/30"
              items={path.bridgeItems}
              onPick={(code) => navigate(`/learn/${code.split('.')[0]}/${code}`)}
              emptyText="No bridge items needed."
            />
            <PathColumn
              title="Reinforcement"
              subtitle="Resume weakness in clusters your college covers well — practice to catch up."
              colorClass="border-l-amber-500 bg-amber-50/30"
              items={path.reinforcementItems}
              onPick={(code) => navigate(`/learn/${code.split('.')[0]}/${code}`)}
              emptyText="No reinforcement items needed."
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreBar({ value, color, sub }: { value: number; color: 'blue'|'violet'|'amber'; sub: string }) {
  const colorMap = {
    blue:   { bar: 'bg-blue-600',   text: 'text-blue-700',   bg: 'bg-blue-100' },
    violet: { bar: 'bg-violet-600', text: 'text-violet-700', bg: 'bg-violet-100' },
    amber:  { bar: 'bg-amber-500',  text: 'text-amber-700',  bg: 'bg-amber-100' },
  }
  const c = colorMap[color]
  return (
    <div>
      <div className="flex items-baseline gap-1 mb-0.5">
        <span className={clsx('text-[13px] font-bold leading-none', c.text)}>{value}</span>
        <span className="text-[8px] text-slate">/100</span>
      </div>
      <div className={clsx('h-1.5 rounded-full overflow-hidden', c.bg)}>
        <div className={clsx('h-full rounded-full', c.bar)} style={{ width: `${value}%` }} />
      </div>
      <div className="text-[8px] text-slate mt-0.5">{sub}</div>
    </div>
  )
}

function PathColumn({ title, subtitle, colorClass, items, onPick, emptyText }: {
  title: string; subtitle: string; colorClass: string
  items: AugmentationPath['permanentGapItems']
  onPick: (subtopicCode: string) => void
  emptyText: string
}) {
  return (
    <div className={clsx('rounded-md border border-rule overflow-hidden', colorClass, 'border-l-[4px]')}>
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-bold text-navy">{title}</h3>
        <p className="text-[10px] text-slate mt-0.5 leading-relaxed">{subtitle}</p>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-[11px] text-slate text-center italic">{emptyText}</div>
      ) : (
        <div className="bg-white border-t border-rule">
          {items.map(it => (
            <button
              key={it.subtopicCode}
              onClick={() => onPick(it.subtopicCode)}
              className="w-full px-4 py-2.5 text-left border-b border-rule last:border-0 hover:bg-cloud/40 transition-colors flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-navy truncate">{it.subtopicName}</div>
                <div className="text-[10px] text-slate font-mono mt-0.5">{it.subtopicCode}</div>
              </div>
              <span className="text-[10px] font-bold text-slate ml-2 flex-shrink-0">P{it.priority}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
