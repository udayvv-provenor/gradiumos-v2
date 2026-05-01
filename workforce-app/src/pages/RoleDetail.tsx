import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiFormFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { ClusterBars } from '../components/ClusterBars'
import { RadarChart } from '../components/RadarChart'
import type { Role, RoleStatus } from '../types'
import clsx from 'clsx'

type Tab = 'overview' | 'jd' | 'pipeline' | 'discover' | 'calibrate'

// ─── BC 122 — Role status controls ───────────────────────────────────────────

const ROLE_STATUS_CHIP: Record<RoleStatus, string> = {
  draft:  'bg-slate-100 text-slate-600 border-slate-200',
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  closed: 'bg-red-50 text-red-600 border-red-200',
}

const ROLE_TRANSITIONS: Record<RoleStatus, RoleStatus[]> = {
  draft:  ['active'],
  active: ['paused', 'closed'],
  paused: ['active', 'closed'],
  closed: [],
}

const TRANSITION_LABELS: Record<RoleStatus, string> = {
  draft:  'Activate',
  active: 'Pause',
  paused: 'Re-activate',
  closed: 'Close',
}

function RoleStatusPanel({ roleId, currentStatus }: { roleId: string; currentStatus: RoleStatus }) {
  const queryClient = useQueryClient()
  const nextStates = ROLE_TRANSITIONS[currentStatus] ?? []

  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/v1/workforce/roles/${roleId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, status) => {
      showToast(`Role ${status === 'active' ? 'activated' : status === 'paused' ? 'paused' : 'closed'}.`)
      void queryClient.invalidateQueries({ queryKey: ['role', roleId] })
    },
    onError: (e: Error) => showToast(e.message),
  })

  return (
    <div className="flex items-center gap-2">
      <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full border', ROLE_STATUS_CHIP[currentStatus])}>
        {currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}
      </span>
      {nextStates.map((nextState) => (
        <button
          key={nextState}
          onClick={() => changeStatus.mutate(nextState)}
          disabled={changeStatus.isPending}
          className={clsx(
            'px-3 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-60',
            nextState === 'closed'
              ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              : nextState === 'paused'
              ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
          )}
        >
          {TRANSITION_LABELS[nextState] ?? nextState}
        </button>
      ))}
    </div>
  )
}

export default function RoleDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [jdText, setJdText] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const roleQ = useQuery<Role>({
    queryKey: ['role', id],
    queryFn: () => apiFetch(`/api/workforce/roles/${id!}`),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  // v3.1.1 — auto-land on the JD tab when the role has no JD yet (the role
  // is essentially incomplete without it; Overview won't have meaningful
  // archetype/cluster data either). Guards against the "where do I upload
  // the JD?" confusion the user hit on first test.
  useEffect(() => {
    if (roleQ.data && !roleQ.data.jdText && tab === 'overview') {
      setTab('jd')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleQ.data?.id])

  const role = roleQ.data

  async function handleJdSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file && !jdText.trim()) { showToast('Paste a JD or upload a PDF'); return }
    if (file && file.size > 5 * 1024 * 1024) { showToast('PDF must be ≤5 MB'); return }
    setIsExtracting(true)
    try {
      if (file) {
        const fd = new FormData(); fd.append('file', file)
        await apiFormFetch(`/api/workforce/roles/${id!}/jd`, fd)
      } else {
        await apiFetch(`/api/workforce/roles/${id!}/jd`, { method: 'POST', body: JSON.stringify({ text: jdText }) })
      }
      roleQ.refetch()
    } catch (err) { showToast(err instanceof Error ? err.message : 'Failed to process JD') }
    finally { setIsExtracting(false) }
  }

  if (roleQ.isLoading) return <div className="text-slate text-sm p-4">Loading role…</div>
  if (!role) return <div className="text-red-600 text-sm p-4">Role not found.</div>

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <button onClick={() => navigate('/roles')} className="text-slate hover:text-navy transition-colors">← Roles</button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{role.title}</span>
      </div>

      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-[19px] font-bold text-navy">{role.title}</h1>
            {role.archetype ? (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-light text-accent">{role.archetype}</span>
            ) : (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Upload a JD to classify">Pending JD</span>
            )}
          </div>
          <p className="text-xs text-slate mb-2">{role.seatsPlanned} seat{role.seatsPlanned === 1 ? '' : 's'} planned · {role.applicantCount} applicant{role.applicantCount === 1 ? '' : 's'}</p>
          {/* BC 122 — Role status state machine controls */}
          <RoleStatusPanel roleId={id!} currentStatus={role.status ?? 'active'} />
        </div>
        {/* v3.1.1 — header-level Upload JD CTA when missing */}
        {!role.jdText && (
          <button
            onClick={() => setTab('jd')}
            className="px-4 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors flex-shrink-0"
          >
            ↑ Upload Job Description
          </button>
        )}
      </div>

      <div className="flex border-b border-rule mb-5">
        {([['overview', 'Overview'], ['jd', 'Job Description'], ['pipeline', 'Pipeline'], ['discover', 'GitHub Talent'], ['calibrate', 'Calibrate & Discover']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={clsx('px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors', tab === t ? 'border-accent text-accent' : 'border-transparent text-slate hover:text-navy')}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Archetype', value: role.archetype ?? 'Pending JD' },
            { label: 'Career Track', value: role.careerTrackName ?? '—' },
            { label: 'Seats Planned', value: String(role.seatsPlanned ?? 1) },
            { label: 'Applicants', value: String(role.applicantCount) },
            { label: 'Posted', value: new Date(role.createdAt).toLocaleDateString() },
            { label: 'JD Status', value: role.jdText ? 'Uploaded' : 'Not uploaded' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-md border border-rule shadow-card p-4">
              <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5">{label}</div>
              <div className="text-base font-bold text-navy">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* JD Tab — v3.1.1: condition on jdText alone (was: !jdText && !clusterTargets,
          which silently passed because createRole sets FALLBACK_TARGETS to keep the
          DB row valid → users saw 8 fake-extracted bars before uploading anything). */}
      {tab === 'jd' && (
        <div className="max-w-2xl">
          {!role.jdText ? (
            <div className="bg-white rounded-md border border-rule shadow-card p-6">
              <h2 className="text-sm font-bold text-navy mb-1">Upload Job Description</h2>
              <p className="text-xs text-slate mb-4">Paste your JD or upload a PDF. GradiumOS will extract cluster targets and requirements automatically.</p>
              <form onSubmit={handleJdSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-navy mb-1.5">Paste JD text</label>
                  <textarea value={jdText} onChange={e => setJdText(e.target.value)} rows={8} placeholder="Paste job description here…"
                    className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors resize-y" />
                </div>
                <div className="flex items-center gap-3"><div className="flex-1 h-px bg-rule" /><span className="text-xs text-slate">or upload PDF</span><div className="flex-1 h-px bg-rule" /></div>
                <input ref={fileRef} type="file" accept=".pdf" className="w-full text-sm text-slate file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-accent-light file:text-accent" />
                {isExtracting ? (
                  <div className="flex items-center gap-3 py-3 px-4 bg-accent-light rounded text-accent text-sm font-medium">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Extracting cluster targets…
                  </div>
                ) : (
                  <button type="submit" className="py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">Extract cluster targets →</button>
                )}
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {role.jdText && (
                <details className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
                  <summary className="px-4 py-3 text-sm font-semibold text-navy cursor-pointer hover:bg-cloud/50">Job Description (click to expand)</summary>
                  <div className="px-4 pb-4 text-xs text-slate whitespace-pre-wrap leading-relaxed border-t border-rule pt-3">{role.jdText}</div>
                </details>
              )}
              {role.clusterTargets && (
                <div className="bg-white rounded-md border border-rule shadow-card p-6">
                  <h2 className="text-sm font-bold text-navy mb-1">Extracted Cluster Targets</h2>
                  <p className="text-xs text-slate mb-4">AI-extracted from the JD. Shape shows which competencies this role demands most.</p>
                  <div className="grid md:grid-cols-2 gap-4 items-center">
                    <div>
                      <RadarChart
                        size={320}
                        series={[{
                          label: 'This role',
                          color: 'violet',
                          values: ['C1','C2','C3','C4','C5','C6','C7','C8'].map((c) => Number((role.clusterTargets as Record<string, number>)[c] ?? 0)),
                        }]}
                      />
                    </div>
                    <div>
                      <ClusterBars scores={role.clusterTargets} />
                    </div>
                  </div>
                </div>
              )}
              {role.extractedRequirements && role.extractedRequirements.length > 0 && (
                <div className="bg-white rounded-md border border-rule shadow-card p-6">
                  <h2 className="text-sm font-bold text-navy mb-3">Extracted Requirements</h2>
                  <ul className="flex flex-col gap-1.5">
                    {role.extractedRequirements.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink">
                        <span className="text-accent font-bold flex-shrink-0 mt-0.5">·</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* BC 121 — Pipeline Tab: navigates to dedicated /roles/:id/pipeline page */}
      {tab === 'pipeline' && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center max-w-lg">
          <div className="text-sm font-bold text-navy mb-2">Application Pipeline</div>
          <p className="text-xs text-slate mb-5">
            View stage-by-stage counts, advance candidates through the pipeline, and track every application for this role.
          </p>
          <button
            onClick={() => navigate(`/roles/${id}/pipeline`)}
            className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
          >
            Open Pipeline →
          </button>
        </div>
      )}

      {/* v3.1.9 — GitHub Talent Discovery tab. Live-pulls public GitHub
       * profiles, AI-shapes each into the GradiumOS 8-cluster vocabulary,
       * matchScore vs role.clusterTargets via the locked formula. Day-0
       * value even with zero learners enrolled on the platform. */}
      {tab === 'discover' && <GitHubTalentTab roleId={id!} />}

      {/* BC 99-103 — Calibrate & Discover tab: navigates to dedicated page */}
      {tab === 'calibrate' && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center max-w-lg">
          <div className="text-sm font-bold text-navy mb-2">Workforce Intelligence</div>
          <p className="text-xs text-slate mb-5">
            Calibrate cluster targets against market P50, view the Institute Opportunity Map, and discover matched candidates — all in one place.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(`/roles/${id}/calibrate`)}
              className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
            >
              Open Calibrate →
            </button>
            <button
              onClick={() => navigate(`/roles/${id}/discovery`)}
              className="px-5 py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors"
            >
              Candidate Discovery →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface GitHubCandidate {
  login: string; name: string | null; bio: string | null
  avatarUrl: string; htmlUrl: string
  publicRepos: number; followers: number
  topLanguages: string[]
  matchPct: number
  clusterTargets: Record<string, number>
  fitNarrative: string
}

function GitHubTalentTab({ roleId }: { roleId: string }) {
  const [city, setCity] = useState<string>(() => localStorage.getItem('gh-talent-city') ?? 'Bangalore')
  function changeCity(v: string) { setCity(v); localStorage.setItem('gh-talent-city', v) }

  const q = useQuery({
    queryKey: ['gh-talent', roleId, city],
    queryFn: () => apiFetch<{ candidates: GitHubCandidate[]; source: 'db-cache'|'live'; hash: string }>(`/api/workforce/roles/${roleId}/github-talent?city=${encodeURIComponent(city)}`),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0]) as { data: { candidates: GitHubCandidate[]; source: 'db-cache'|'live'; hash: string } | undefined; isLoading: boolean; refetch: () => void }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate">Live talent discovery</div>
          <h2 className="text-base font-bold text-navy mt-1">Public GitHub profiles matched to this role</h2>
          <p className="text-xs text-slate mt-1 max-w-2xl">
            We search GitHub for engineers in your city whose public footprint matches this role's cluster targets. Each candidate's bio + top repo languages are AI-shaped into the GradiumOS 8-cluster vocabulary, then ranked by the locked match formula. <strong>No learner has to be on the platform.</strong> Cached 24h per (role, city) to respect GitHub rate limits.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {q.data && (
            <span className={clsx(
              'text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border',
              q.data.source === 'live' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-blue-100 text-blue-800 border-blue-200',
            )}>{q.data.source === 'live' ? 'Live · just pulled' : 'DB cache'}</span>
          )}
          <select value={city} onChange={(e) => changeCity(e.target.value)} className="text-xs px-2 py-1.5 border border-rule rounded bg-white">
            {['Bangalore','Hyderabad','Pune','Chennai','Delhi NCR','Mumbai','Remote India'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={() => q.refetch()} className="text-[10px] text-accent hover:underline">Refresh →</button>
        </div>
      </div>

      {q.isLoading && (
        <div className="bg-white border border-rule rounded p-8 text-center text-sm text-slate">
          Pulling live GitHub profiles for "{city}" + this role's title… (10–25s on first run; cached for 24h after)
        </div>
      )}

      {q.data && q.data.candidates.length === 0 && (
        <div className="bg-white border border-rule rounded p-8 text-center">
          <div className="text-sm font-semibold text-navy mb-1">No public GitHub matches yet</div>
          <p className="text-xs text-slate max-w-md mx-auto">
            Either GitHub returned no users for this role + city combination, or the API rate-limited us. Try a different city or refresh in a minute.
          </p>
        </div>
      )}

      {q.data && q.data.candidates.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {q.data.candidates.map((c) => (
            <a key={c.login} href={c.htmlUrl} target="_blank" rel="noopener noreferrer" className="bg-white border border-rule rounded-md p-4 hover:border-accent/40 hover:shadow-card transition-all no-underline block">
              <div className="flex items-start gap-3">
                <img src={c.avatarUrl} alt={c.login} className="w-12 h-12 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-sm font-bold text-navy truncate">{c.name ?? c.login}</div>
                    <span className={clsx('text-base font-bold tabular-nums whitespace-nowrap',
                      c.matchPct >= 80 ? 'text-green-700' : c.matchPct >= 65 ? 'text-amber-600' : 'text-red-600',
                    )}>{c.matchPct}%</span>
                  </div>
                  <div className="text-[10px] text-slate font-mono mb-1">@{c.login} · {c.publicRepos} repos · {c.followers} followers</div>
                  {c.bio && <div className="text-[11px] text-ink leading-relaxed line-clamp-2 mb-1.5">{c.bio}</div>}
                  <div className="flex gap-1 flex-wrap">
                    {c.topLanguages.slice(0, 4).map((l) => (
                      <span key={l} className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-cloud border border-rule text-slate">{l}</span>
                    ))}
                  </div>
                  <div className="text-[10px] text-slate italic mt-2">{c.fitNarrative}</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
