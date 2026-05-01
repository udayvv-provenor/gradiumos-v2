import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { KpiCard } from '../components/KpiCard'
import { RadarChart } from '../components/RadarChart'
import type { KpiData, Role } from '../types'
import clsx from 'clsx'

/* Strip honorifics + 1-char initials. v3.1.7. */
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

interface RoleInsight {
  role: { id: string; title: string; archetype: string; clusterTargets: Record<string, number> }
  gap: { rows: { clusterCode: string; demand: number; cohortAvg: number; gap: number }[]; cohortSize: number }
  salary: { currency: string; band?: string|null; min?: number|null; median?: number|null; max?: number|null; sources?: string[]; oneLine?: string|null }
  salarySource?: 'live'|'db-cache'|'fallback'
  colleges: { name: string; city?: string|null; nirfRank?: number|null; reasoning?: string|null; url?: string|null }[]
  collegesSource?: 'live'|'db-cache'|'fallback'
  githubPreview: { login: string; name: string|null; avatarUrl: string; htmlUrl: string; matchPct: number; topLanguages: string[] }[]
  githubSource?: 'live'|'db-cache'|'fallback'
}

const POPULAR_CITIES = ['Bangalore','Hyderabad','Pune','Chennai','Delhi NCR','Mumbai','Remote India']

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  // KPIs
  const kpisQ = useQuery<KpiData>({
    queryKey: ['workforce-kpis'],
    queryFn: () => apiFetch('/api/workforce/overview/kpis'),
    staleTime: 0, refetchOnMount: 'always',
  } as any)
  const kpis = kpisQ.data

  // Role list — for picker
  const rolesQ = useQuery<Role[]>({
    queryKey: ['roles-list'],
    queryFn: () => apiFetch('/api/workforce/roles'),
    staleTime: 0, refetchOnMount: 'always',
  } as any)
  const roles = rolesQ.data ?? []

  // Selected role + city
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [city, setCity] = useState<string>(() => localStorage.getItem('wf-city') ?? 'Bangalore')
  function changeCity(v: string) { setCity(v); localStorage.setItem('wf-city', v) }
  useEffect(() => {
    if (!selectedRoleId && roles.length > 0) setSelectedRoleId(roles[0].id)
  }, [roles, selectedRoleId])

  // Rich per-role insight bundle (gap + salary + colleges + GH preview)
  const insightQ = useQuery<RoleInsight>({
    queryKey: ['role-insight', selectedRoleId, city],
    queryFn: () => apiFetch(`/api/workforce/roles/${selectedRoleId}/insight?city=${encodeURIComponent(city)}`),
    enabled: !!selectedRoleId,
    staleTime: 0, refetchOnMount: 'always',
  } as any)

  const insight = insightQ.data
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      {/* Hero */}
      <div className="bg-navy rounded-lg px-7 py-6 mb-5 flex items-center justify-between gap-5">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">{greeting}, {firstName(user?.name) ?? 'there'}</h1>
          <p className="text-xs text-white/50">{user?.employerName} · GradiumOS Workforce</p>
        </div>
        <button
          onClick={() => navigate('/roles')}
          className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors flex-shrink-0"
        >Manage career tracks &amp; roles →</button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-3.5 mb-5">
        <KpiCard label="Open Roles" value={kpisQ.isLoading ? '…' : kpis?.openRoles ?? '—'} delta="Active job postings" onClick={() => navigate('/roles')} badge="Manage →" />
        <KpiCard label="Applications" value={kpisQ.isLoading ? '…' : kpis?.applications ?? '—'} delta="Across all roles" deltaDir="neutral" badge="Index v1.2" badgeColor="violet" />
        <KpiCard label="Above Threshold" value={kpisQ.isLoading ? '…' : kpis?.candidatesAboveThreshold ?? '—'} delta="Candidates meeting requirements" deltaDir="up" badge="View talent →" badgeColor="green" onClick={() => navigate('/roles')} />
      </div>

      {/* Role-level rich insight */}
      {roles.length === 0 ? (
        <div className="bg-white border border-rule rounded-md shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">⚡</div>
          <div className="text-sm font-semibold text-navy mb-1">Post your first role to see live insight</div>
          <p className="text-xs text-slate max-w-md mx-auto mb-4">
            Once a role exists with a JD uploaded, this dashboard turns into a real intelligence panel: gap radar against cohort competencies, live salary intel, recommended sourcing colleges, and a GitHub talent preview — all live-pulled and cached for the team.
          </p>
          <button onClick={() => navigate('/roles/new')} className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark">+ Post a role under a track</button>
        </div>
      ) : (
        <>
          {/* Role + city pickers */}
          <div className="bg-white border border-rule rounded-md shadow-card p-4 mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-[10px] uppercase tracking-wider text-slate font-bold">Role</label>
              <select
                value={selectedRoleId ?? ''}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="text-sm px-3 py-1.5 border border-rule rounded bg-white focus:outline-none focus:border-accent"
              >
                {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
              <label className="text-[10px] uppercase tracking-wider text-slate font-bold ml-3">City</label>
              <select value={city} onChange={(e) => changeCity(e.target.value)} className="text-xs px-2 py-1.5 border border-rule rounded bg-white">
                {POPULAR_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {insight && <button onClick={() => insightQ.refetch()} className="text-[11px] text-accent hover:underline">Refresh insight →</button>}
          </div>

          {insightQ.isLoading && (
            <div className="bg-white border border-rule rounded-md p-8 text-center text-slate text-sm">
              Pulling live intelligence for this role… (gap radar + Serper salary + Groq→Serper→Groq sourcing pipeline + GitHub preview — 15-30s on first run, cached after)
            </div>
          )}

          {insight && (
            <div className="grid grid-cols-12 gap-4">
              {/* Gap radar */}
              <div className="col-span-7 bg-white border border-rule rounded-md shadow-card p-5">
                <div className="mb-2">
                  <h2 className="text-sm font-bold text-navy">Demand vs cohort competency</h2>
                  <p className="text-[10px] text-slate mt-0.5">Where amber (this role's demand) sticks out beyond violet (your cohort's average) — that's where you'll struggle to hire from the platform alone.</p>
                </div>
                <div className="flex justify-center">
                  <RadarChart
                    size={360}
                    series={[
                      { label: 'Role demand', color: 'amber', values: insight.gap.rows.map(r => r.demand) },
                      { label: 'Cohort avg',  color: 'violet', values: insight.gap.rows.map(r => r.cohortAvg) },
                    ]}
                  />
                </div>
                <div className="mt-3 text-[10px] text-slate text-center">
                  Cohort sample: {insight.gap.cohortSize} learners with at least one assessment. Recompute is via the locked CompetencyScore formula.
                </div>
              </div>

              {/* Salary intel */}
              <div className="col-span-5 bg-white border border-rule rounded-md shadow-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-navy">Salary intelligence</h2>
                  <SourcePill source={insight.salarySource ?? (insight.salary?.median != null ? 'live' : 'fallback')} />
                </div>
                {insight.salary?.median != null ? (
                  <>
                    <div className="text-3xl font-bold text-accent mt-1">{insight.salary.median} <span className="text-sm text-slate">{insight.salary.currency}</span></div>
                    <div className="text-xs text-slate mt-1">
                      Range: {insight.salary.min ?? '?'} – {insight.salary.max ?? '?'} {insight.salary.currency} · Band: {insight.salary.band ?? 'Mid'}
                    </div>
                    {insight.salary.oneLine && <p className="text-[12px] text-ink mt-3 leading-relaxed italic">"{insight.salary.oneLine}"</p>}
                    {insight.salary.sources && insight.salary.sources.length > 0 && (
                      <div className="text-[10px] text-slate mt-3">Sources: {insight.salary.sources.join(', ')}</div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate mt-2">Salary data not yet retrieved for this role + city. Click Refresh to pull live (Serper + Groq).</p>
                )}
              </div>

              {/* Recommended sourcing colleges */}
              <div className="col-span-7 bg-white border border-rule rounded-md shadow-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-navy">Recommended sourcing colleges</h2>
                  <SourcePill source={insight.collegesSource ?? (insight.colleges.length > 0 ? 'live' : 'fallback')} />
                </div>
                <p className="text-[10px] text-slate mb-3">Groq suggests → Serper enriches each with placement-record snippets → Groq ranks for {insight.role.archetype} archetype.</p>
                {insight.colleges.length > 0 ? (
                  <div className="space-y-2">
                    {insight.colleges.slice(0, 8).map((c, i) => (
                      <div key={i} className="flex items-start gap-3 p-2 rounded hover:bg-cloud/40">
                        <div className="text-xs font-bold text-slate w-6 text-center">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-bold text-navy hover:text-accent no-underline">{c.name}</a>
                            ) : (
                              <span className="text-[12.5px] font-bold text-navy">{c.name}</span>
                            )}
                            {c.city && <span className="text-[10px] text-slate">· {c.city}</span>}
                            {c.nirfRank && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cloud border border-rule text-slate">NIRF #{c.nirfRank}</span>}
                          </div>
                          {c.reasoning && <p className="text-[11px] text-ink leading-relaxed mt-0.5">{c.reasoning}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate mt-2">Sourcing recommendations not yet computed.</p>
                )}
              </div>

              {/* GitHub preview */}
              <div className="col-span-5 bg-white border border-rule rounded-md shadow-card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-navy">GitHub talent preview</h2>
                  <button onClick={() => navigate(`/roles/${insight.role.id}`)} className="text-[10px] text-accent hover:underline">View all →</button>
                </div>
                {insight.githubPreview.length > 0 ? (
                  <div className="space-y-2">
                    {insight.githubPreview.map((c) => (
                      <a key={c.login} href={c.htmlUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2 rounded hover:bg-cloud/40 no-underline">
                        <img src={c.avatarUrl} alt={c.login} className="w-9 h-9 rounded-full flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-bold text-navy truncate">{c.name ?? c.login}</div>
                          <div className="text-[10px] text-slate">@{c.login} · {c.topLanguages.slice(0, 3).join(', ')}</div>
                        </div>
                        <span className={clsx('text-sm font-bold tabular-nums',
                          c.matchPct >= 80 ? 'text-green-700' : c.matchPct >= 65 ? 'text-amber-600' : 'text-red-600',
                        )}>{c.matchPct}%</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate mt-2">GitHub preview not yet pulled. Open the role's GitHub Talent tab to refresh.</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SourcePill({ source }: { source: 'live'|'db-cache'|'fallback' }) {
  const map = {
    'live':     { label: 'Live AI',  cls: 'bg-green-100 text-green-800 border-green-200' },
    'db-cache': { label: 'DB cache', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
    'fallback': { label: 'Fallback', cls: 'bg-red-100 text-red-800 border-red-200' },
  } as const
  const m = map[source]
  return <span className={clsx('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border', m.cls)}>{m.label}</span>
}
