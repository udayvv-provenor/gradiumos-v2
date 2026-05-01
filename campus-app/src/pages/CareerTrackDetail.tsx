import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiFormFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { ClusterBars } from '../components/ClusterBars'
import type { CareerTrack, CurriculumResult, Learner, GapReport } from '../types'
import clsx from 'clsx'

type Tab = 'overview' | 'curriculum' | 'learners'

export default function CareerTrackDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('overview')
  const [pastedText, setPastedText] = useState('')
  const [curriculumResult, setCurriculumResult] = useState<CurriculumResult | null>(null)
  const [isMapping, setIsMapping] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const trackQ = useQuery<CareerTrack>({
    queryKey: ['career-track', id],
    queryFn: () => apiFetch(`/api/campus/career-tracks/${id!}`),
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const learnersQ = useQuery<Learner[]>({
    queryKey: ['track-learners', id],
    queryFn: () => apiFetch(`/api/campus/career-tracks/${id!}/learners`),
    enabled: tab === 'learners',
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  // v3.1 — Overview tab now previews the Gap Report inline so the Dean sees the
  // IP signal one click sooner. We fetch only when on Overview to avoid
  // unnecessary load on Curriculum / Learners tabs.
  const gapQ = useQuery<GapReport>({
    queryKey: ['track-gap-preview', id],
    queryFn: () => apiFetch(`/api/campus/career-tracks/${id!}/gap-report`),
    enabled: tab === 'overview',
    onError: (e: Error) => showToast(e.message),
  } as Parameters<typeof useQuery>[0])

  const track = trackQ.data

  async function handleCurriculumSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file && !pastedText.trim()) {
      showToast('Please paste curriculum text or upload a PDF')
      return
    }
    if (file && file.size > 5 * 1024 * 1024) {
      showToast('PDF must be 5 MB or smaller')
      return
    }

    setIsMapping(true)
    setCurriculumResult(null)
    try {
      let result: CurriculumResult
      if (file) {
        const fd = new FormData()
        fd.append('file', file)
        result = await apiFormFetch<CurriculumResult>(`/api/campus/career-tracks/${id!}/curriculum`, fd)
      } else {
        result = await apiFetch<CurriculumResult>(`/api/campus/career-tracks/${id!}/curriculum`, {
          method: 'POST',
          body: JSON.stringify({ text: pastedText }),
        })
      }
      setCurriculumResult(result)
      // v3.1.1 — invalidate dashboard + gap-preview queries too so the Dean
      // sees fresh numbers when they navigate back to /dashboard or this
      // track's overview tab.
      qc.invalidateQueries({ queryKey: ['career-track', id] })
      qc.invalidateQueries({ queryKey: ['track-gap-preview', id] })
      qc.invalidateQueries({ queryKey: ['campus-kpis'] })
      qc.invalidateQueries({ queryKey: ['campus-gaps'] })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to process curriculum')
    } finally {
      setIsMapping(false)
    }
  }

  if (trackQ.isLoading) return <div className="text-slate text-sm p-4">Loading track…</div>
  if (!track) return <div className="text-red-600 text-sm p-4">Track not found.</div>

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <button onClick={() => navigate('/career-tracks')} className="text-slate hover:text-navy transition-colors">
          ← Career Tracks
        </button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">{track.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[19px] font-bold text-navy">{track.name}</h1>
            <span className="font-mono text-xs text-slate bg-cloud border border-rule px-2 py-0.5 rounded">{track.code}</span>
            {/* v3.1.1 — track-level archetype removed; archetype mix surfaces on the Gap Report */}
            {track.archetype && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-light text-accent">{track.archetype}</span>
            )}
          </div>
          <p className="text-xs text-slate">{track.learnerCount} learner{track.learnerCount === 1 ? '' : 's'} enrolled</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/career-tracks/${id}/cohort-gap`)}
            className="px-3 py-1.5 bg-white border border-rule text-navy text-xs font-semibold rounded hover:bg-cloud transition-colors"
          >
            Cohort Intelligence
          </button>
          <button
            onClick={() => navigate(`/career-tracks/${id}/gap-report`)}
            className="px-3 py-1.5 bg-navy text-white text-xs font-semibold rounded hover:bg-navy/90 transition-colors flex items-center gap-1.5"
          >
            ◊ View Gap Report
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-rule mb-5 gap-0">
        {(['overview', 'curriculum', 'learners'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors capitalize',
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-slate hover:text-navy'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview Tab — v3.1 bulkup: KPIs + Gap preview + Curriculum status + CTAs */}
      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          {/* KPI strip — v3.1.1 dropped Archetype card (track no longer carries one) */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Learners', value: String(track.learnerCount) },
              {
                label: 'Overall Readiness',
                value: gapQ.data ? `${gapQ.data.overallReadiness}%` : (gapQ.isLoading ? '…' : '—'),
              },
              {
                label: 'Curriculum',
                value: gapQ.data?.curriculumId ? 'Mapped' : (gapQ.isLoading ? '…' : 'Not mapped'),
              },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-md border border-rule shadow-card p-4">
                <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5">{label}</div>
                <div className="text-base font-bold text-navy">{value}</div>
              </div>
            ))}
          </div>

          {/* Two-column body: gap preview + curriculum + CTAs */}
          <div className="grid grid-cols-3 gap-4">
            {/* Gap preview — 2/3 width */}
            <div className="col-span-2 bg-white rounded-md border border-rule shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-rule flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-semibold text-navy">Cohort Gap — Curriculum vs Demand</div>
                  <div className="text-[10px] text-slate mt-0.5">
                    {gapQ.data
                      ? `${gapQ.data.demand.sampleSize} active roles · ${gapQ.data.demand.totalSeats} seats · seat-weighted, recency-decayed`
                      : 'Loading…'}
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/career-tracks/${id}/gap-report`)}
                  className="text-[11px] font-semibold text-accent hover:underline"
                >
                  Full report →
                </button>
              </div>
              <div className="p-4">
                {gapQ.isLoading && <div className="text-xs text-slate text-center py-6">Computing gap…</div>}
                {gapQ.isError && <div className="text-xs text-red-600 text-center py-6">Failed to load gap data.</div>}
                {gapQ.data && (
                  <div className="flex flex-col gap-1.5">
                    {gapQ.data.perCluster.map((g) => {
                      const sevColor = g.severity === 'critical' ? 'bg-red-600'
                        : g.severity === 'moderate' ? 'bg-amber-500'
                        : 'bg-green-700'
                      return (
                        <div key={g.clusterCode} className="flex items-center gap-2 text-[11px]">
                          <span className="font-bold text-slate w-6 flex-shrink-0">{g.clusterCode}</span>
                          <span className="text-ink truncate flex-1 max-w-[140px]">{g.clusterName}</span>
                          <div className="w-20 h-1.5 bg-cloud rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${g.curriculumPct}%` }} />
                          </div>
                          <span className="w-7 text-right font-bold text-violet-700">{g.curriculumPct}</span>
                          <span className="text-slate">vs</span>
                          <div className="w-20 h-1.5 bg-cloud rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${g.demandPct}%` }} />
                          </div>
                          <span className="w-7 text-right font-bold text-amber-700">{g.demandPct}</span>
                          <span className={clsx('w-12 text-center text-[9px] font-bold rounded-full px-1.5 py-0.5 text-white', sevColor)}>
                            {g.severity === 'critical' ? 'CRIT' : g.severity === 'moderate' ? 'MOD' : g.severity === 'minor' ? 'MIN' : 'OK'}
                          </span>
                        </div>
                      )
                    })}
                    <div className="flex items-center gap-3 mt-2 text-[9px] text-slate">
                      <div className="flex items-center gap-1"><div className="w-2 h-2 bg-violet-500 rounded-full" />Curriculum</div>
                      <div className="flex items-center gap-1"><div className="w-2 h-2 bg-amber-500 rounded-full" />Aggregated demand</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar — Curriculum status + Quick actions */}
            <div className="flex flex-col gap-3">
              {/* Curriculum status */}
              <div className="bg-white rounded-md border border-rule shadow-card p-4">
                <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Curriculum status</div>
                {gapQ.data?.curriculumId ? (
                  <>
                    <div className="text-[13px] font-bold text-navy mb-0.5">Mapped to C1–C8</div>
                    <p className="text-[11px] text-slate mb-3">Curriculum is fed into the gap engine. Top contributing subjects appear in the full Gap Report.</p>
                    <button
                      onClick={() => setTab('curriculum')}
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      Re-upload curriculum →
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-[13px] font-bold text-amber-700 mb-0.5">Not mapped yet</div>
                    <p className="text-[11px] text-slate mb-3">Upload a syllabus or course outline to compute the cluster-coverage signal.</p>
                    <button
                      onClick={() => setTab('curriculum')}
                      className="w-full py-2 bg-accent text-white text-[11px] font-semibold rounded hover:bg-accent-dark transition-colors"
                    >
                      Upload curriculum →
                    </button>
                  </>
                )}
              </div>

              {/* Top employers contributing to demand */}
              {gapQ.data && gapQ.data.demand.topEmployers.length > 0 && (
                <div className="bg-white rounded-md border border-rule shadow-card p-4">
                  <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Demand source</div>
                  <p className="text-[10px] text-slate mb-2 leading-snug">Top employers shaping the demand signal on this track:</p>
                  <div className="flex flex-col gap-1">
                    {gapQ.data.demand.topEmployers.slice(0, 5).map((e) => (
                      <div key={e.name} className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-navy truncate">{e.name}</span>
                        <span className="text-[10px] text-slate flex-shrink-0 ml-2">{e.roleCount} role{e.roleCount === 1 ? '' : 's'} · {e.seatTotal} seat{e.seatTotal === 1 ? '' : 's'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Critical augmentation teaser */}
              {gapQ.data && gapQ.data.augmentations.length > 0 && (
                <div className="bg-gradient-to-br from-accent/10 to-accent-light/40 border border-accent/30 rounded-md p-4">
                  <div className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-2">AI-suggested intervention</div>
                  <p className="text-[11px] text-ink leading-snug mb-2">
                    <strong className="text-navy">{gapQ.data.augmentations[0].area}</strong> · {gapQ.data.augmentations[0].effort} effort
                  </p>
                  <p className="text-[10px] text-slate leading-snug">{gapQ.data.augmentations[0].recommendation.slice(0, 140)}{gapQ.data.augmentations[0].recommendation.length > 140 ? '…' : ''}</p>
                  <button
                    onClick={() => navigate(`/career-tracks/${id}/gap-report`)}
                    className="text-[11px] font-semibold text-accent hover:underline mt-2"
                  >
                    See all suggestions →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Curriculum Tab */}
      {tab === 'curriculum' && (
        <div className="max-w-2xl">
          {!curriculumResult && (
            <div className="bg-white rounded-md border border-rule shadow-card p-6">
              <h2 className="text-sm font-bold text-navy mb-1">Upload Curriculum</h2>
              <p className="text-xs text-slate mb-4">Paste your curriculum text or upload a PDF (≤5 MB). GradiumOS will map it to C1–C8 clusters.</p>
              <form onSubmit={handleCurriculumSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-navy mb-1.5">Paste curriculum text</label>
                  <textarea
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    rows={8}
                    placeholder="Paste syllabus, course outline, or curriculum description here…"
                    className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors resize-y"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-rule" />
                  <span className="text-xs text-slate">or upload PDF</span>
                  <div className="flex-1 h-px bg-rule" />
                </div>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    className="w-full text-sm text-slate file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-accent-light file:text-accent hover:file:bg-accent/20 transition-colors"
                  />
                </div>
                {isMapping ? (
                  <div className="flex items-center gap-3 py-3 px-4 bg-accent-light rounded text-accent text-sm font-medium">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Mapping to C1–C8… this may take a moment
                  </div>
                ) : (
                  <button
                    type="submit"
                    className="py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
                  >
                    Map curriculum →
                  </button>
                )}
              </form>
            </div>
          )}

          {curriculumResult && (
            <div className="flex flex-col gap-4">
              <div className="bg-white rounded-md border border-rule shadow-card p-6">
                <h2 className="text-sm font-bold text-navy mb-3">Cluster Coverage</h2>
                <ClusterBars scores={curriculumResult.clusterCoverage} />
              </div>
              <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
                <div className="px-4 py-3 border-b border-rule">
                  <h2 className="text-[12.5px] font-semibold text-navy">Extracted Subjects ({curriculumResult.subjects.length})</h2>
                </div>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {['Subject', 'Clusters', 'Coverage'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {curriculumResult.subjects.map((s, i) => (
                      <tr key={i} className="border-b border-rule last:border-0 align-middle">
                        <td className="px-4 py-2.5 font-medium text-navy w-[55%]">{s.name}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {/* v3.1.1 — flex-nowrap so all 8 cluster pills sit on one line */}
                          <div className="flex gap-1 flex-nowrap">
                            {s.clusters.map(c => (
                              <span key={c} className="text-[10px] font-bold px-1.5 py-0.5 bg-accent-light text-accent rounded font-mono">{c}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-cloud rounded-full overflow-hidden">
                              <div className="h-full bg-accent rounded-full" style={{ width: `${s.coverage}%` }} />
                            </div>
                            <span className="text-xs font-bold text-ink w-9 text-right">{s.coverage}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => { setCurriculumResult(null); setPastedText(''); if (fileRef.current) fileRef.current.value = '' }}
                className="text-xs text-slate hover:text-navy transition-colors self-start"
              >
                ← Upload different curriculum
              </button>
            </div>
          )}
        </div>
      )}

      {/* Learners Tab */}
      {tab === 'learners' && (
        <div>
          {learnersQ.isLoading && <div className="text-slate text-sm">Loading learners…</div>}
          {learnersQ.data && learnersQ.data.length === 0 && (
            <div className="bg-white rounded-md border border-rule shadow-card p-10 text-center">
              <div className="text-sm font-semibold text-navy mb-1">No learners enrolled yet</div>
              <p className="text-xs text-slate">Share your institution invite code from the Learners page to enrol students.</p>
            </div>
          )}
          {learnersQ.data && learnersQ.data.length > 0 && (
            <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {['Name', 'Email', 'Readiness', 'Joined'].map(h => (
                      <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {learnersQ.data.map(l => (
                    <tr key={l.id} className="border-b border-rule last:border-0 hover:bg-cloud/50">
                      <td className="px-4 py-2.5 font-medium text-navy">{l.name}</td>
                      <td className="px-4 py-2.5 text-slate">{l.email}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-cloud rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${l.readiness >= 70 ? 'bg-green-700' : l.readiness >= 55 ? 'bg-amber-500' : 'bg-red-600'}`}
                              style={{ width: `${l.readiness}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-ink">{l.readiness}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate text-xs">{new Date(l.joinedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
