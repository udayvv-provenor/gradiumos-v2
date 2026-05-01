import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../state/AuthContext'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { KpiCard } from '../components/KpiCard'
import { ClusterBars } from '../components/ClusterBars'
import { RadarChart } from '../components/RadarChart'
import type { KpiData, CohortGapCluster, GapReport, BridgeToBar, ClusterRecord } from '../types'

/** Strip honorifics ("Dr.", "Mr.", "Ms.", "Prof.") from a full name and
 *  return the first remaining name. Falls back to undefined for empty. */
// v3.1.7 — also skip 1-2 char tokens (likely initials, e.g. "Dr K M Iyer" → "Iyer")
function firstName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const HONORIFICS = new Set(['dr', 'dr.', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'prof', 'prof.']);
  const parts = name.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    const stripped = p.replace(/\.+$/, '');
    if (HONORIFICS.has(p.toLowerCase())) continue;
    if (stripped.length <= 1) continue;       // single-letter initial — skip
    return p;
  }
  return parts[0];
}

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // v3.1.1 — refetchOnMount + refetchOnWindowFocus added so the dashboard
  // updates when the Dean returns from creating a track / uploading curriculum
  // (those mutations invalidate the cache, but the dashboard wasn't always
  // remounted between visits — now it refetches on every focus + mount).
  const kpisQ = useQuery<KpiData>({
    queryKey: ['campus-kpis'],
    queryFn: () => apiFetch('/api/campus/overview/kpis'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const gapsQ = useQuery<CohortGapCluster[]>({
    queryKey: ['campus-gaps'],
    queryFn: () => apiFetch('/api/campus/insight/cohort-gaps'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  // v3.1.1 — per-track performance overview (was in v1/v2 demos, dropped in v3 rebuild, restored here)
  const tracksOverviewQ = useQuery<Array<{
    id: string; name: string; code: string;
    learnerCount: number; readiness: number;
    curriculumMapped: boolean; curriculumUploadedAt: string | null;
    sectorDemand: { roles: number; seats: number; employers: number };
  }>>({
    queryKey: ['campus-tracks-overview'],
    queryFn: () => apiFetch('/api/campus/tracks-overview'),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const kpis = kpisQ.data
  const gaps = gapsQ.data ?? []
  const tracksOverview = tracksOverviewQ.data ?? []

  // v3.1.3 — drill-down: which track to show in the curriculum-vs-demand radar
  const [drillTrackId, setDrillTrackId] = useState<string | null>(null)
  useEffect(() => {
    if (!drillTrackId && tracksOverview.length > 0) setDrillTrackId(tracksOverview[0].id)
  }, [tracksOverview, drillTrackId])

  const drillGapQ = useQuery<GapReport>({
    queryKey: ['dashboard-drill-gap', drillTrackId],
    queryFn: () => apiFetch(`/api/campus/career-tracks/${drillTrackId!}/gap-report`),
    enabled: !!drillTrackId,
    onError: () => null,
  } as Parameters<typeof useQuery>[0])
  const drillGap = drillGapQ.data
  const drillTrack = tracksOverview.find(t => t.id === drillTrackId)

  const gapScores: Record<string, number> = {}
  gaps.forEach(g => { gapScores[g.id] = g.score })

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      {/* Hero */}
      <div className="bg-navy rounded-lg px-7 py-6 mb-5 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">
            {greeting}, {firstName(user?.name) ?? 'there'}
          </h1>
          <p className="text-xs text-white/50">{user?.institutionName} · GradiumOS Campus</p>
        </div>
        <div className="flex gap-3">
          <div className="text-center bg-white/[0.06] rounded-md px-4 py-3 min-w-[90px]">
            <div className="text-2xl font-bold text-gold leading-none mb-1">
              {kpis ? kpis.totalLearners : '—'}
            </div>
            <div className="text-[10px] text-white/45">Enrolled</div>
          </div>
          <div className="text-center bg-white/[0.06] rounded-md px-4 py-3 min-w-[90px]">
            <div className="text-2xl font-bold text-gold leading-none mb-1">
              {kpis ? `${kpis.averageReadiness}%` : '—'}
            </div>
            <div className="text-[10px] text-white/45">Avg Readiness</div>
          </div>
          <div className="text-center bg-white/[0.06] rounded-md px-4 py-3 min-w-[90px]">
            <div className="text-2xl font-bold text-gold leading-none mb-1">
              {kpis ? kpis.careerTracks : '—'}
            </div>
            <div className="text-[10px] text-white/45">Career Tracks</div>
          </div>
        </div>
      </div>

      {/* v3.1.6 — Live institution public profile (NIRF/NAAC/AISHE).
       * First Dean to view any given institution triggers Serper × 3 + Groq
       * extraction; result lands in Postgres publicDataCache; subsequent
       * Deans get it from DB. Provenance chips show source URLs. */}
      <PublicProfileCard />

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3.5 mb-5">
        <KpiCard
          label="Total Learners"
          value={kpisQ.isLoading ? '…' : (kpis?.totalLearners ?? '—')}
          delta="Enrolled across all tracks"
          deltaDir="neutral"
          badge="View learners →"
          badgeColor="blue"
          onClick={() => navigate('/learners')}
        />
        <KpiCard
          label="Average Readiness"
          value={kpisQ.isLoading ? '…' : kpis ? `${kpis.averageReadiness}%` : '—'}
          delta="Across all active cohorts"
          deltaDir="neutral"
          badge={kpis?.averageConfidence !== undefined
            ? `Confidence ${kpis.averageConfidence >= 0.7 ? 'HIGH' : kpis.averageConfidence >= 0.4 ? 'MED' : 'LOW'}`
            : 'Confidence —'}
          badgeColor={(kpis?.averageConfidence ?? 0) >= 0.7 ? 'green' : (kpis?.averageConfidence ?? 0) >= 0.4 ? 'amber' : 'blue'}
        />
        <KpiCard
          label="Career Tracks"
          value={kpisQ.isLoading ? '…' : (kpis?.careerTracks ?? '—')}
          delta="Active GradiumOS tracks"
          deltaDir="neutral"
          badge="Manage tracks →"
          badgeColor="blue"
          onClick={() => navigate('/career-tracks')}
        />
      </div>

      {/* BC 113 — Bridge-to-Bar widget */}
      <BridgeToBarWidget />

      {/* v3.1.3 — restructured per Uday's feedback. Order is now:
          1. Per-Career-Track Performance (the LEAD signal — track vs demand)
          2. Drill-down: selected track's curriculum-vs-demand RADAR
          3. Cohort Gap (8 clusters, all-tracks-combined) — secondary
          4. Top Priority Clusters — only when real data exists. */}

      {/* §1 — Per-Career-Track Performance (lead) */}
      <div className="mb-5 bg-white rounded-md border border-rule shadow-card overflow-hidden">
        <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
          <div>
            <span className="text-[12.5px] font-semibold text-navy">Per-Career-Track Performance</span>
            <span className="text-xs text-slate ml-2">How each of your tracks is performing — placement-readiness vs sector demand</span>
          </div>
          <button onClick={() => navigate('/career-tracks')} className="text-xs font-medium text-accent hover:underline">View all tracks →</button>
        </div>
        {tracksOverviewQ.isLoading && (
          <div className="px-5 py-8 text-center text-slate text-sm">Loading per-track view…</div>
        )}
        {!tracksOverviewQ.isLoading && tracksOverview.length === 0 && (
          <div className="px-5 py-10 text-center">
            <div className="text-sm font-semibold text-navy mb-1">No career tracks yet</div>
            <p className="text-xs text-slate max-w-md mx-auto mb-4">Create your first career track to see per-track readiness, curriculum mapping status, and sector demand for graduates of that track.</p>
            <button onClick={() => navigate('/career-tracks/new')} className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors">+ Create first career track</button>
          </div>
        )}
        {tracksOverview.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['Career Track', 'Learners', 'Readiness', 'Curriculum', 'Sector Demand', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide bg-cloud border-b border-rule">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracksOverview.map(t => (
                <tr key={t.id} className="border-b border-rule last:border-0 hover:bg-cloud/40 cursor-pointer" onClick={() => navigate(`/career-tracks/${t.id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent-light text-accent">{t.code}</span>
                      <span className="font-medium text-navy">{t.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink">{t.learnerCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-cloud rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${t.readiness >= 70 ? 'bg-green-700' : t.readiness >= 55 ? 'bg-amber-500' : 'bg-red-600'}`} style={{ width: `${t.readiness}%` }} />
                      </div>
                      <span className={`text-xs font-bold ${t.readiness >= 70 ? 'text-green-700' : t.readiness >= 55 ? 'text-amber-600' : 'text-red-600'}`}>{t.readiness}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t.curriculumMapped ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Mapped</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Upload pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate">
                    {t.sectorDemand.roles > 0 ? (
                      <span><strong className="text-navy">{t.sectorDemand.employers}</strong> employer{t.sectorDemand.employers === 1 ? '' : 's'} · <strong className="text-navy">{t.sectorDemand.seats}</strong> seat{t.sectorDemand.seats === 1 ? '' : 's'}</span>
                    ) : (
                      <span className="italic text-slate/70">no demand yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-xs font-medium text-accent hover:underline" onClick={e => { e.stopPropagation(); navigate(`/career-tracks/${t.id}/gap-report`) }}>Gap report →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* §2 — Drill-down: SELECTED track's curriculum-vs-demand RADAR (the IP visual) */}
      {drillTrack && drillGap && (
        <div className="mb-5 bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
            <div>
              <span className="text-[12.5px] font-semibold text-navy">{drillTrack.name} — Curriculum vs Sector Demand</span>
              <span className="text-xs text-slate ml-2">8-cluster radar · {drillGap.demand.sampleSize} active role{drillGap.demand.sampleSize === 1 ? '' : 's'}, {drillGap.demand.totalSeats} seats · seat-weighted, recency-decayed</span>
            </div>
            <div className="flex items-center gap-3">
              {tracksOverview.length > 1 && (
                <select
                  value={drillTrackId ?? ''}
                  onChange={e => setDrillTrackId(e.target.value)}
                  className="text-xs px-2 py-1 border border-rule rounded bg-white"
                >
                  {tracksOverview.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button onClick={() => navigate(`/career-tracks/${drillTrack.id}/gap-report`)} className="text-xs font-medium text-accent hover:underline">Full report →</button>
            </div>
          </div>
          <div className="p-5 flex justify-center">
            <RadarChart
              size={420}
              series={[
                { label: 'Your curriculum', color: 'violet', values: drillGap.perCluster.map(c => c.curriculumPct) },
                { label: 'Aggregated demand', color: 'amber',  values: drillGap.perCluster.map(c => c.demandPct) },
              ]}
            />
          </div>
        </div>
      )}

      {/* §3 — Cohort Gap Intelligence (all-tracks combined) + side panels */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-navy">Cohort Gap Intelligence</span>
            <span className="text-[10px] text-slate">Across all tracks</span>
          </div>
          <div className="p-4">
            {gaps.length === 0 ? (
              <div className="text-center py-8 text-slate text-sm">No gap data available yet. Upload a curriculum to generate cluster analysis.</div>
            ) : (
              <>
                <ClusterBars scores={gapScores} />
                <div className="flex gap-3 mt-3 flex-wrap">
                  {[
                    { color: 'bg-green-700', label: 'Above (≥70)' },
                    { color: 'bg-amber-500', label: 'Near (55–70)' },
                    { color: 'bg-red-600', label: 'Below (<55)' },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5 text-[10px] text-slate">
                      <div className={`w-2 h-2 rounded-full ${color}`} />{label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right column: only Top Priority Clusters when real data exists. Quick Actions removed (CTAs already on per-track table + sidebar). */}
        <div className="flex flex-col gap-4">
          {gaps.length > 0 && gaps.some(g => g.score > 0 || g.pctBelow > 0) && (
            <div className="bg-white rounded-md border border-rule shadow-card p-4">
              <h3 className="text-[12.5px] font-semibold text-navy mb-3">Top Priority Clusters</h3>
              <div className="flex flex-col gap-2">
                {[...gaps].filter(g => g.score > 0 || g.pctBelow > 0).sort((a, b) => a.score - b.score).slice(0, 3).map(g => (
                  <div
                    key={g.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded border-l-[3px] ${
                      g.score < 55 ? 'bg-red-50 border-l-red-600' : 'bg-amber-50 border-l-amber-500'
                    }`}
                  >
                    <span className={`text-[11px] font-bold w-5 ${g.score < 55 ? 'text-red-600' : 'text-amber-600'}`}>{g.id}</span>
                    <div className="flex-1">
                      <div className="text-xs font-medium text-ink">{g.name}</div>
                      <div className="text-[10px] text-slate">{g.pctBelow}% below threshold</div>
                    </div>
                    <span className={`text-xs font-bold ${g.score < 55 ? 'text-red-600' : 'text-amber-600'}`}>{g.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Empty-state CTA card when no tracks at all */}
          {tracksOverview.length === 0 && (
            <div className="bg-white rounded-md border border-rule shadow-card p-4">
              <h3 className="text-[12.5px] font-semibold text-navy mb-1">Get started</h3>
              <p className="text-xs text-slate mb-4">Set up your first career track + invite learners.</p>
              <div className="flex flex-col gap-2.5">
                <button onClick={() => navigate('/career-tracks/new')} className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">+ Create career track</button>
                <button onClick={() => navigate('/learners')} className="w-full py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors">Invite learners</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* PublicProfileCard — v3.1.6 demonstrates the live → DB-cache → pull pattern.
 * On first render, hits /campus/me/institution/public-profile. Server checks
 * publicDataCache; cache-miss triggers live Serper × 3 + Groq extraction; result
 * persists; subsequent loads serve from DB. The pill shows the actual source. */
interface PubProfile {
  nirfRank: number | null; nirfScore: number | null
  nirfBand: string | null; naacGrade: string | null
  state: string | null; enrolmentRange: string | null
  sources: { kind: string; url: string; snippet: string }[]
  retrievedAt: string
}
function PublicProfileCard() {
  const q = useQuery({
    queryKey: ['institution-public-profile'],
    queryFn: () => apiFetch<{ profile: PubProfile; source: 'live'|'db-cache'|'fallback' }>('/api/campus/me/institution/public-profile'),
  } as Parameters<typeof useQuery>[0]) as { data: { profile: PubProfile; source: 'live'|'db-cache'|'fallback' } | undefined; isLoading: boolean; refetch: () => void }
  if (q.isLoading) return <div className="bg-white border border-rule rounded-md p-4 mb-5 text-xs text-slate">Pulling your institution's public footprint live (NIRF + NAAC + AISHE)…</div>
  if (!q.data) return null
  const { profile, source } = q.data
  const srcCls = source === 'live' ? 'bg-green-100 text-green-800 border-green-200' : source === 'db-cache' ? 'bg-blue-100 text-blue-800 border-blue-200' : 'bg-red-100 text-red-800 border-red-200'
  const srcLabel = source === 'live' ? 'Live · just pulled' : source === 'db-cache' ? 'DB cache · pulled earlier' : 'Fallback · live integrations offline'
  return (
    <div className="bg-white border border-rule rounded-md shadow-card p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-navy">Your institution's public footprint</h3>
          <p className="text-[10px] text-slate mt-0.5">Live-pulled from public sources by Serper + Groq, cached in our DB. Re-pull to refresh.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${srcCls}`}>{srcLabel}</span>
          <button onClick={() => q.refetch()} className="text-[10px] text-accent hover:underline">Refresh →</button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <ProfileStat label="NIRF rank" value={profile.nirfRank?.toString() ?? '—'} hint={profile.nirfBand ?? ''} />
        <ProfileStat label="NIRF score" value={profile.nirfScore?.toString() ?? '—'} hint="0-100" />
        <ProfileStat label="NAAC" value={profile.naacGrade ?? '—'} hint={profile.state ?? ''} />
        <ProfileStat label="Enrolment" value={profile.enrolmentRange ?? '—'} hint="AISHE proxy" />
      </div>
      {profile.sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-rule">
          <div className="text-[9px] uppercase tracking-wider text-slate font-bold mb-1.5">Provenance</div>
          <div className="flex gap-2 flex-wrap">
            {profile.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-1 rounded bg-cloud border border-rule text-slate hover:text-navy hover:border-accent">
                {s.kind} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
function ProfileStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="text-center bg-cloud/60 rounded p-3">
      <div className="text-[9px] uppercase tracking-wider text-slate font-bold mb-1">{label}</div>
      <div className="text-base font-bold text-navy leading-none">{value}</div>
      {hint && <div className="text-[9px] text-slate mt-1">{hint}</div>}
    </div>
  )
}

// ─── BC 113 — Bridge-to-Bar Widget ────────────────────────────────────────────
// Shows institution cohort median vs employer P50 with data-state badge.
// Baseline = no live data yet (< 5 attempts), Mixed = some data, Live = 30+ learners.

const CLUSTERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'] as const

function BridgeToBarWidget() {
  const q = useQuery<BridgeToBar>({
    queryKey: ['bridge-to-bar'],
    queryFn: () => apiFetch('/api/v1/campus/bridge-to-bar'),
    staleTime: 60_000,
    onError: () => null,
  } as Parameters<typeof useQuery>[0])

  if (q.isLoading) return null
  if (!q.data) return null
  const d = q.data

  const stateConfig = {
    Baseline: { cls: 'bg-slate-100 text-slate-600 border-slate-300', label: 'Baseline — insufficient live data', desc: 'Showing market baseline. Upload assessments to build live cohort data.' },
    Mixed:    { cls: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Mixed — some live data',           desc: `${d.progressToLive.current} of ${d.progressToLive.required} learners have enough attempts for Live mode.` },
    Live:     { cls: 'bg-green-100 text-green-700 border-green-300', label: 'Live — cohort data active',        desc: 'Cohort median is computed from live learner scores.' },
  }[d.dataState]

  return (
    <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden mb-5">
      <div className="px-4 py-3.5 border-b border-rule flex items-center justify-between">
        <div>
          <span className="text-[12.5px] font-semibold text-navy">Bridge to Bar</span>
          <span className="text-xs text-slate ml-2">Your cohort vs employer P50 across all tracks</span>
        </div>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${stateConfig.cls}`}>
          {d.dataState}
        </span>
      </div>

      <div className="p-5">
        <p className="text-[10px] text-slate mb-4">{stateConfig.desc}</p>

        {/* Bar chart: cohort vs employer P50 per cluster */}
        <div className="flex flex-col gap-2">
          {CLUSTERS.map(c => {
            const cohort = d.cohortMedian ? (d.cohortMedian as ClusterRecord)[c] : null
            const p50 = (d.employerP50 as ClusterRecord)[c]
            const gap = d.gap[c]
            return (
              <div key={c} className="flex items-center gap-3">
                <div className="w-7 text-[10px] font-bold text-slate">{c}</div>
                <div className="flex-1 relative h-5 bg-cloud rounded overflow-hidden">
                  {/* Employer P50 bar (background) */}
                  <div
                    className="absolute inset-y-0 left-0 bg-amber-100 border-r-2 border-amber-400"
                    style={{ width: `${p50}%` }}
                  />
                  {/* Cohort median bar (foreground) */}
                  {cohort !== null && (
                    <div
                      className={`absolute inset-y-0 left-0 ${cohort >= p50 ? 'bg-green-400' : 'bg-accent'} opacity-70`}
                      style={{ width: `${cohort}%` }}
                    />
                  )}
                </div>
                <div className="w-20 text-right text-[10px]">
                  {cohort !== null ? (
                    <span className={gap !== null && gap > 5 ? 'text-red-600 font-semibold' : 'text-slate'}>
                      {cohort.toFixed(0)} / {p50.toFixed(0)}
                    </span>
                  ) : (
                    <span className="text-slate">— / {p50.toFixed(0)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Progress to Live */}
        {d.dataState !== 'Live' && (
          <div className="mt-4 pt-4 border-t border-rule">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-slate">Progress to Live mode</span>
              <span className="text-[10px] text-slate">{d.progressToLive.current} / {d.progressToLive.required} learners</span>
            </div>
            <div className="w-full h-1.5 bg-cloud rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${Math.min(100, (d.progressToLive.current / d.progressToLive.required) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
