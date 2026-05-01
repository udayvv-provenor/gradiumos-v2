import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type {
  SignalDashboard,
  GapsData,
  ClusterBar,
  GapCluster,
  ConfidenceBand,
  SignalBand,
} from '../types'

/**
 * Phase C intelligence surfaces — BC 76-85.
 *
 * BC 76 — 8 cluster bars with score + confidence chip colour; suppressed clusters
 *          shown with hatched fill + "More practice needed" label.
 * BC 77 — Confidence chip colour: green/amber/grey/suppressed (hatched).
 * BC 78 — Signal score + band when active; "Take more assessments" CTA when suppressed.
 * BC 79 — "Your gaps" card: top 3 weakest non-suppressed clusters + 3 CTAs each.
 * BC 80 — Trajectory chart slot: stubbed with TODO comment; renders only when data exists.
 */

// ─── Colour maps ─────────────────────────────────────────────────────────────

const CONFIDENCE_CHIP: Record<ConfidenceBand, string> = {
  green:      'bg-green-50 text-green-700 border-green-200',
  amber:      'bg-amber-50 text-amber-700 border-amber-200',
  grey:       'bg-slate-50 text-slate-500 border-slate-200',
  suppressed: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
}

const CONFIDENCE_CHIP_LABEL: Record<ConfidenceBand, string> = {
  green:      'HIGH',
  amber:      'MED',
  grey:       'LOW',
  suppressed: 'SUPP',
}

const SIGNAL_BAND_CHIP: Record<SignalBand, string> = {
  Advanced:   'bg-green-100 text-green-800',
  Proficient: 'bg-blue-100 text-blue-800',
  Developing: 'bg-amber-100 text-amber-800',
  Emerging:   'bg-slate-100 text-slate-600',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// v3.1.7 — skip 1-char initials so "Dr K M Iyer" returns "Iyer", not "K"
function firstName(name?: string | null): string | undefined {
  if (!name) return undefined
  const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'prof', 'prof.'])
  const parts = name.split(/\s+/).filter(Boolean)
  for (const p of parts) {
    const stripped = p.replace(/\.+$/, '')
    if (HONORIFICS.has(p.toLowerCase())) continue
    if (stripped.length <= 1) continue
    return p
  }
  return parts[0]
}

// ─── Bar component (BC 76/77) ─────────────────────────────────────────────────

function ClusterBarRow({ c }: { c: ClusterBar }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="font-bold text-slate w-6 flex-shrink-0">{c.clusterCode}</span>
      <span className="text-ink truncate flex-1 max-w-[140px]">{c.clusterName}</span>

      {/* BC 76 — bar, hatched fill for suppressed */}
      <div className="flex-1 h-2 bg-cloud rounded-full overflow-hidden relative">
        {c.suppressed ? (
          <svg width="100%" height="100%" style={{ borderRadius: '9999px' }}>
            <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeOpacity="0.5" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#hatch)" />
          </svg>
        ) : (
          <div
            className={`h-full rounded-full ${
              c.scoreWeighted >= 70 ? 'bg-green-700'
                : c.scoreWeighted >= 55 ? 'bg-amber-500'
                : 'bg-red-600'
            }`}
            style={{ width: `${c.scoreWeighted}%` }}
          />
        )}
      </div>

      {/* Score */}
      <span className="font-bold text-ink w-7 text-right">
        {c.suppressed ? '—' : c.scoreWeighted}
      </span>

      {/* BC 77 — confidence chip */}
      <span
        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border w-12 text-center ${CONFIDENCE_CHIP[c.confidenceBand as ConfidenceBand]}`}
        title={c.suppressed ? 'More practice needed — confidence below threshold' : `Confidence: ${Math.round(c.confidence * 100)}%`}
      >
        {CONFIDENCE_CHIP_LABEL[c.confidenceBand as ConfidenceBand]}
      </span>
    </div>
  )
}

// ─── Gap card component (BC 79) ──────────────────────────────────────────────

function GapCard({ g, onLesson, onAssess }: { g: GapCluster; onLesson: () => void; onAssess: () => void }) {
  return (
    <div className="bg-cloud rounded p-3 border-l-[3px] border-l-red-500">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-bold text-slate mr-1">{g.clusterCode}</span>
        <span className="text-[10px] font-bold text-red-700">{g.scoreWeighted}</span>
      </div>
      <div className="text-[12.5px] font-semibold text-navy mb-1 leading-tight">{g.clusterName}</div>
      <div className="text-[10px] text-slate mb-2.5">
        Confidence <strong className="text-navy">{Math.round(g.confidence * 100)}%</strong>
      </div>

      {/* BC 79 — 3 CTAs per gap cluster */}
      <div className="flex flex-col gap-1">
        <button
          onClick={onLesson}
          className="w-full py-1 text-[10px] font-semibold rounded bg-accent text-white hover:bg-accent-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Open lesson
        </button>
        <button
          onClick={onAssess}
          className="w-full py-1 text-[10px] font-semibold rounded bg-white border border-rule hover:border-accent hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Practice assessment
        </button>
        {g.pathwayExists ? (
          <button
            onClick={onLesson}
            className="w-full py-1 text-[10px] font-semibold rounded bg-white border border-rule hover:border-green-500 hover:text-green-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            View pathway
          </button>
        ) : (
          <button
            disabled
            className="w-full py-1 text-[10px] font-semibold rounded bg-white border border-rule text-slate/40 cursor-not-allowed"
            title="No augmentation pathway available yet for this cluster"
          >
            No pathway yet
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // BC 76-78 — signal endpoint (new v1 route)
  const { data: signal, isLoading: signalLoading } = useQuery<SignalDashboard>({
    queryKey: ['v1-signal'],
    queryFn: () => apiFetch<SignalDashboard>('/api/v1/talent/me/signal'),
  } as Parameters<typeof useQuery<SignalDashboard>>[0])

  // BC 79 — gaps endpoint
  const { data: gapsData } = useQuery<GapsData>({
    queryKey: ['v1-gaps'],
    queryFn: () => apiFetch<GapsData>('/api/v1/talent/me/gaps'),
  } as Parameters<typeof useQuery<GapsData>>[0])

  const clusterBars: ClusterBar[] = (signal as SignalDashboard | undefined)?.clusterBars ?? []
  const gaps: GapCluster[] = (gapsData as GapsData | undefined)?.gaps ?? []
  const signalData = signal as SignalDashboard | undefined

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const avgScore = clusterBars.length
    ? Math.round(clusterBars.reduce((s, c) => s + c.scoreWeighted, 0) / clusterBars.length)
    : 0

  const hasSuppressed = clusterBars.some((c) => c.suppressed)

  return (
    <div className="max-w-full overflow-x-hidden">
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="bg-navy rounded-lg px-4 sm:px-7 py-4 sm:py-5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-white mb-1">
            {greeting}, {firstName(user?.name) ?? 'there'}
          </h1>
          <p className="text-xs text-white/50">{user?.institutionName ?? 'GradiumOS Talent'}</p>
        </div>

        <div className="flex gap-3">
          {/* Avg readiness tile */}
          <div className="text-center bg-white/[0.06] rounded-md px-4 py-2.5 min-w-[100px] sm:min-w-[110px]">
            <div className="text-2xl font-bold text-gold leading-none mb-0.5">
              {signalLoading ? '…' : `${avgScore}`}
            </div>
            <div className="text-[10px] text-white/50">Avg readiness</div>
          </div>

          {/* BC 78 — Signal score tile */}
          <div className="text-center bg-white/[0.06] rounded-md px-4 py-2.5 min-w-[100px] sm:min-w-[110px]">
            {signalData && !signalData.suppressed ? (
              <>
                <div className="text-2xl font-bold text-gold leading-none mb-0.5">
                  {signalData.signalScore}
                </div>
                <div className="text-[10px] text-white/50 mb-1">GradiumOS Signal</div>
                <span className={`inline-flex text-[8px] font-bold px-1.5 py-0.5 rounded-full ${SIGNAL_BAND_CHIP[signalData.signalBand as SignalBand]}`}>
                  {signalData.signalBand.toUpperCase()}
                </span>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-white/30 leading-none mb-0.5">—</div>
                <div className="text-[10px] text-white/50">GradiumOS Signal</div>
                <div className="text-[9px] text-white/50 mt-1">Not yet active</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── BC 78 — Suppressed CTA banner ──────────────────────────────────── */}
      {signalData?.suppressed && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-5 py-3.5 mb-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-amber-900 mb-0.5">
              Your GradiumOS Signal is not active yet
            </div>
            <p className="text-xs text-amber-700">
              Complete more assessments across clusters to build enough confidence for your Signal to publish.
            </p>
          </div>
          <button
            onClick={() => navigate('/assessments')}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Take assessments →
          </button>
        </div>
      )}

      {/* ── BC 76/77 — Cluster bars: 8 rows ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="md:col-span-2 bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-navy">
              Your competency — C1 to C8
            </span>
            {signalLoading && <span className="text-xs text-slate">Loading…</span>}
          </div>

          <div className="p-4">
            {clusterBars.length === 0 ? (
              <div className="text-center py-6 text-slate text-sm">
                No cluster data yet. Open{' '}
                <button onClick={() => navigate('/assessments')} className="text-accent hover:underline font-semibold">
                  Assessments
                </button>{' '}
                to start building your profile.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {clusterBars.map((c) => (
                  <ClusterBarRow key={c.clusterCode} c={c} />
                ))}

                {/* BC 76 — suppressed legend */}
                {hasSuppressed && (
                  <div className="text-[9px] text-slate mt-1 italic">
                    Hatched bars = more practice needed before Signal is published for this cluster.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick stats card */}
        <div className="bg-white rounded-md border border-rule shadow-card p-4">
          <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-3">
            Your progress snapshot
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex justify-between items-center text-sm mb-1">
                <span className="text-slate">Active clusters</span>
                <span className="font-bold text-navy">
                  {clusterBars.length ? `${clusterBars.filter((c) => !c.suppressed).length} / 8` : '— / 8'}
                </span>
              </div>
              <div className="h-1.5 bg-cloud rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full"
                  style={{ width: `${(clusterBars.filter((c) => !c.suppressed).length / 8) * 100}%` }}
                />
              </div>
            </div>

            {signalData && !signalData.suppressed && (
              <>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate">Signal band</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SIGNAL_BAND_CHIP[signalData.signalBand as SignalBand]}`}>
                    {signalData.signalBand}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate">Confidence</span>
                  <span className="font-bold text-navy">
                    {Math.round(signalData.overallConfidence * 100)}%
                  </span>
                </div>
              </>
            )}

            <div className="border-t border-rule pt-3 mt-1">
              <button
                onClick={() => navigate('/opportunities')}
                className="w-full py-2 bg-cloud hover:bg-rule text-navy text-xs font-semibold rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                See matched opportunities →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── BC 79 — "Your gaps" card ────────────────────────────────────────── */}
      <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden mb-5">
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between gap-4">
          <div>
            <div className="text-[12.5px] font-semibold text-navy">Your gaps</div>
            <div className="text-[11px] text-slate mt-0.5">
              Top 3 weakest clusters where your confidence is strong enough to trust the score.
            </div>
          </div>
          <button
            onClick={() => navigate('/assessments')}
            className="text-xs font-semibold px-3 py-1.5 bg-accent text-white rounded hover:bg-accent-dark transition-colors flex-shrink-0"
          >
            Practice assessments →
          </button>
        </div>

        <div className="p-5">
          {gaps.length === 0 ? (
            <div className="text-center py-6 text-slate text-sm">
              <div className="text-3xl mb-2 opacity-30">◎</div>
              <p>No confirmed gaps yet — take more assessments to establish your baseline.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {gaps.map((g) => (
                <GapCard
                  key={g.clusterCode}
                  g={g}
                  onLesson={() => navigate(`/learn#${g.clusterCode}`)}
                  onAssess={() => navigate('/assessments')}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── BC 80 — Trajectory chart slot ──────────────────────────────────── */}
      {/*
       * TODO (BC 80 — trajectory chart): For each cluster in `clusterBars`,
       * fetch `GET /api/v1/talent/me/clusters/:code/trajectory` (returns
       * `{ trajectory: [{score: number, submittedAt: string}] }`) and render a
       * sparkline or line chart. Only render if trajectory.length > 0.
       *
       * Suggested approach:
       *   1. Add a per-cluster <TrajectorySparkline clusterCode={c.clusterCode} /> component.
       *   2. Inside it: useQuery(['trajectory', code], () => apiFetch(`/api/v1/talent/me/clusters/${code}/trajectory`))
       *   3. Render with recharts <LineChart> or a lightweight SVG sparkline.
       *   4. Mount alongside the cluster bar rows in the C1-C8 detail panel,
       *      or in a collapsible cluster detail drawer triggered by clicking a bar.
       */}
    </div>
  )
}
