import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { Role, CareerTrackGroup } from '../types'
import clsx from 'clsx'

/* v3.1.2 — career tracks are now DYNAMIC. This page shows ONLY tracks where
 * THIS employer has at least one role. To post under a brand-new track, use
 * the "+ New role" CTA which surfaces a typeahead/create field. The shared
 * platform catalogue lives at /api/career-tracks/search?q=... */
export default function Roles() {
  const navigate = useNavigate()

  const { data: roles = [], isLoading } = useQuery<Role[]>({
    queryKey: ['roles'],
    queryFn: () => apiFetch('/api/workforce/roles'),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  // Group employer's roles by track. We do NOT pad with canonical tracks
  // anymore — tracks are now dynamic (no fixed list). Empty state is "you
  // haven't posted under any track yet → click + New role to start."
  const groups: CareerTrackGroup[] = groupByCareerTrack(roles).sort((a, b) => b.roles.length - a.roles.length)

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Career Tracks</h1>
          <p className="text-xs text-slate mt-0.5">
            Tracks you're hiring under. Roles are grouped by career track; aggregated demand across your roles in a track feeds the track-level signal that institutions and learners see.
          </p>
        </div>
        <button
          onClick={() => navigate('/roles/new')}
          className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
          title="Pick a career track first, then add the role under it, then upload the JD"
        >
          + Post a role under a track
        </button>
      </div>

      {isLoading && <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">Loading career tracks…</div>}

      {!isLoading && groups.length === 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">◫</div>
          <div className="text-sm font-semibold text-navy mb-1">No career tracks yet</div>
          <p className="text-xs text-slate max-w-md mx-auto mb-4">
            <strong className="text-navy">The order is: career track → role → JD.</strong> Click below to start. You can pick from the platform catalogue or create a brand-new career track on the fly — AI maps it to the GradiumOS cluster vocabulary automatically.
          </p>
          <button onClick={() => navigate('/roles/new')} className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">+ Post first role</button>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map(g => <CareerTrackSection key={g.careerTrackId} group={g} navigate={navigate} />)}
      </div>
    </div>
  )
}

function CareerTrackSection({ group, navigate }: { group: CareerTrackGroup; navigate: ReturnType<typeof useNavigate> }) {
  // Pull aggregated demand for this track — separate query so the page renders
  // role-data fast and demand fills in second
  const { data: demand } = useQuery<{ clusterTargets: Record<string, number>; sampleSize: number; totalSeats: number }>({
    queryKey: ['demand', group.careerTrackId],
    queryFn: () => apiFetch(`/api/aggregation/demand/${group.careerTrackId}`),
    onError: () => null,
  } as Parameters<typeof useQuery>[0])

  return (
    <section className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
      {/* Track header */}
      <div className="px-5 py-3.5 border-b border-rule flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-accent-light text-accent mt-0.5 font-mono">{group.careerTrackCode}</span>
          <div>
            <div className="text-sm font-semibold text-navy">{group.careerTrackName}</div>
            <div className="text-[10px] text-slate mt-0.5">
              {group.roles.length} {group.roles.length === 1 ? 'role' : 'roles'} · {group.totalSeats} total seats · {group.totalApplicants} applicants
            </div>
          </div>
          {/* v3.1.1 — per-track "Add role" CTA so the parent-child structure is obvious */}
          <button
            onClick={() => navigate(`/roles/new?track=${group.careerTrackId}`)}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-accent text-accent hover:bg-accent hover:text-white transition-colors mt-0.5"
            title={`Add a new role under ${group.careerTrackName}`}
          >
            + Role under this track
          </button>
        </div>
        {/* Aggregated demand snapshot */}
        {demand && demand.sampleSize > 0 && (
          <div className="text-right">
            <div className="text-[9px] font-semibold text-slate uppercase tracking-wide mb-1">
              Aggregated demand (your roles + sector)
            </div>
            <div className="flex gap-1 items-end h-7">
              {(['C1','C2','C3','C4','C5','C6','C7','C8'] as const).map(c => {
                const v = demand.clusterTargets[c] ?? 0
                return (
                  <div key={c} className="flex flex-col items-center" title={`${c}: ${v}`}>
                    <div
                      className={clsx('w-2 rounded-sm',
                        v >= 70 ? 'bg-green-700' : v >= 55 ? 'bg-amber-500' : 'bg-red-600'
                      )}
                      style={{ height: `${(v / 100) * 28}px` }}
                    />
                    <span className="text-[7px] text-slate font-mono mt-0.5">{c.slice(1)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* v3.1.1 — empty-track CTA so the TA sees a "create first role here" affordance */}
      {group.roles.length === 0 && (
        <div className="px-5 py-6 text-center bg-cloud/30">
          <div className="text-xs text-slate mb-2">No roles posted under {group.careerTrackName} yet.</div>
          <button
            onClick={() => navigate(`/roles/new?track=${group.careerTrackId}`)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded bg-accent text-white hover:bg-accent-dark transition-colors"
          >
            + Post first role under {group.careerTrackCode}
          </button>
        </div>
      )}

      {/* Roles in this track */}
      {group.roles.length > 0 && (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {['Role Title', 'Seats', 'Applicants', 'Posted', ''].map(h => (
              <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide bg-cloud/50 border-b border-rule">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.roles.map(r => (
            <tr key={r.id} className="border-b border-rule last:border-0 hover:bg-cloud/40 cursor-pointer" onClick={() => navigate(`/roles/${r.id}`)}>
              <td className="px-4 py-2.5 font-semibold text-navy flex items-center gap-2">
                {r.title}
                {!r.jdText && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">JD MISSING</span>}
              </td>
              <td className="px-4 py-2.5 text-ink">{r.seatsPlanned}</td>
              <td className="px-4 py-2.5 text-ink">{r.applicantCount}</td>
              <td className="px-4 py-2.5 text-slate text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-2.5 text-right">
                <button className="text-xs font-medium text-accent hover:underline" onClick={e => { e.stopPropagation(); navigate(`/roles/${r.id}`) }}>Open →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  )
}

function groupByCareerTrack(roles: Role[]): CareerTrackGroup[] {
  const m = new Map<string, CareerTrackGroup>()
  for (const r of roles) {
    const id = r.careerTrackId ?? 'unknown'
    const name = r.careerTrackName ?? 'Unassigned'
    const code = r.careerTrackCode ?? '—'
    if (!m.has(id)) m.set(id, { careerTrackId: id, careerTrackName: name, careerTrackCode: code, totalSeats: 0, totalApplicants: 0, roles: [] })
    const g = m.get(id)!
    g.roles.push(r)
    g.totalSeats += r.seatsPlanned
    g.totalApplicants += r.applicantCount
  }
  return [...m.values()].sort((a, b) => b.roles.length - a.roles.length)
}
