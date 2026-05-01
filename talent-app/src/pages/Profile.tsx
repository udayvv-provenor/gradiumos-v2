import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch, apiFormFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import type { ResumeProfile, TrackRecommendation } from '../types'
import clsx from 'clsx'
import { RadarChart } from '../components/RadarChart'

/* Profile — the entry to the Talent path. Three states:
 *  1. No resume yet → upload form (paste or PDF)
 *  2. Resume parsed → show extracted profile + track recommendations
 *  3. Track selected → CTA to open the 3-way map for that track
 *
 * This page is the Talent counterpart to Workforce uploading JDs and
 * Campus uploading curricula — it's where "demand → curriculum → me"
 * gets stitched together. */
export default function Profile() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [pastedText, setPastedText] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  const profileQ = useQuery<{ profile: ResumeProfile | null }>({
    queryKey: ['my-profile'],
    queryFn: () => apiFetch('/api/talent/me/profile'),
    onError: () => null,
  } as Parameters<typeof useQuery>[0])

  const recsQ = useQuery<TrackRecommendation[]>({
    queryKey: ['track-recommendations'],
    queryFn: () => apiFetch('/api/talent/me/track-recommendations'),
    enabled: !!profileQ.data?.profile,
    onError: () => null,
  } as Parameters<typeof useQuery>[0])

  const uploadJSON = useMutation<{ parsed: ResumeProfile }, Error, string>({
    mutationFn: (text) => apiFetch('/api/talent/me/profile/resume', { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: () => {
      showToast('Resume parsed!', 'success')
      // v3.1.10 — invalidate EVERY downstream query that depends on the resume
      qc.invalidateQueries({ queryKey: ['my-profile'] })
      qc.invalidateQueries({ queryKey: ['my-profile-gate'] })
      qc.invalidateQueries({ queryKey: ['track-recommendations'] })
      qc.invalidateQueries({ queryKey: ['three-way-map'] })
      qc.invalidateQueries({ queryKey: ['augmentation-path'] })
      qc.invalidateQueries({ queryKey: ['learn-index'] })
      qc.invalidateQueries({ queryKey: ['curriculum-coverage'] })
      setPastedText('')
    },
    onError: (e) => showToast(e.message),
  })

  async function handleFileUpload(file: File) {
    setIsUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      await apiFormFetch('/api/talent/me/profile/resume', fd)
      showToast('Resume parsed!', 'success')
      qc.invalidateQueries({ queryKey: ['my-profile'] })
      qc.invalidateQueries({ queryKey: ['my-profile-gate'] })
      qc.invalidateQueries({ queryKey: ['track-recommendations'] })
      qc.invalidateQueries({ queryKey: ['three-way-map'] })
      qc.invalidateQueries({ queryKey: ['augmentation-path'] })
      qc.invalidateQueries({ queryKey: ['learn-index'] })
      qc.invalidateQueries({ queryKey: ['curriculum-coverage'] })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed')
    } finally { setIsUploading(false) }
  }

  const profile = profileQ.data?.profile
  const welcome = new URLSearchParams(window.location.search).get('welcome') === '1'

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[19px] font-bold text-navy">Your Profile</h1>
        <p className="text-xs text-slate mt-0.5">
          Upload your resume → AI maps your competencies → recommends career tracks → builds your learning path.
        </p>
      </div>

      {welcome && !profile && (
        <div className="mb-5 bg-gradient-to-br from-accent/10 to-gold/10 border-l-[3px] border-accent rounded p-4 max-w-2xl">
          <div className="text-sm font-bold text-navy mb-1">First step: tell us what you already know</div>
          <p className="text-[12px] text-ink leading-relaxed">
            Without your resume, our augmentation plan assumes <strong>college gaps = your gaps</strong>. That's wrong if you've already learned things outside class. Upload your resume now so the AI plan is built around what <strong>you</strong> need, not what your cohort needs.
          </p>
        </div>
      )}

      {/* No-profile state — upload form */}
      {!profile && (
        <div className="bg-white rounded-md border border-rule shadow-card p-6 max-w-2xl">
          <h2 className="text-sm font-bold text-navy mb-1">Upload your resume to begin</h2>
          <p className="text-xs text-slate mb-4">
            Paste your resume text or upload a PDF (≤5 MB). The AI will extract your C1–C8 competency profile and recommend career tracks where you fit best.
          </p>
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">Paste resume text</label>
              <textarea
                value={pastedText}
                onChange={e => setPastedText(e.target.value)}
                rows={10}
                placeholder="Paste your resume — name, experience, skills, education, projects…"
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors resize-y font-mono"
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-rule" />
              <span className="text-xs text-slate">or upload PDF</span>
              <div className="flex-1 h-px bg-rule" />
            </div>
            <input
              type="file" accept=".pdf"
              onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
              className="text-sm text-slate file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-accent-light file:text-accent"
            />
            {(uploadJSON.isPending || isUploading) ? (
              <div className="flex items-center gap-3 py-3 px-4 bg-accent-light rounded text-accent text-sm font-medium">
                <span className="inline-block w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                Extracting your competency profile…
              </div>
            ) : (
              <button
                onClick={() => uploadJSON.mutate(pastedText)}
                disabled={!pastedText.trim() || pastedText.length < 80}
                className="py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-50"
              >
                Parse my resume →
              </button>
            )}
          </div>
        </div>
      )}

      {/* v3.1.9 — primary 3-way-map CTA. Visible the moment a resume is parsed,
       * even before track-recommendations resolve. Uses the FIRST recommendation
       * if present, OR falls back to the learner's institution-track (always
       * exists for an enrolled learner). This guarantees the user always has a
       * working "see my path" entry — the button Uday saw not opening was
       * waiting for the recs API which can briefly be empty on first parse. */}
      {profile && (
        <div className="mb-5 bg-gradient-to-br from-accent/10 to-gold/5 border border-accent/30 rounded-md p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-navy">Your 3-way map is ready</div>
            <p className="text-xs text-slate mt-0.5 max-w-xl">
              See where your resume stands today, where your college will eventually take you, and where employer demand actually sits — all on one radar. The space between the three is what AI augments.
            </p>
          </div>
          <PrimaryPathButton recommendations={recsQ.data ?? []} navigate={navigate} />
        </div>
      )}

      {/* Profile shown — clusters + recommendations */}
      {profile && (
        <div className="grid grid-cols-12 gap-5">
          {/* Identity card */}
          <div className="col-span-4 bg-white border border-rule rounded-md shadow-card p-5">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Parsed identity</div>
            <h2 className="text-base font-bold text-navy mb-1">{profile.candidateName ?? '— name not detected —'}</h2>
            <div className="text-xs text-slate mb-3">{profile.yearsExp} years experience · {profile.archetype} archetype</div>

            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5 mt-3">Declared skills</div>
            <div className="flex gap-1 flex-wrap">
              {profile.declaredSkills.length > 0 ? profile.declaredSkills.map(s => (
                <span key={s} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-cloud border border-rule text-slate">{s}</span>
              )) : <span className="text-[10px] text-slate italic">none parsed</span>}
            </div>

            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-1.5 mt-4">Summary</div>
            <p className="text-[11px] text-ink leading-relaxed">{profile.experienceSummary}</p>

            <button
              onClick={() => { qc.invalidateQueries({ queryKey: ['my-profile'] }); navigate('/profile?reupload=1') }}
              className="mt-4 text-[11px] text-slate hover:text-navy transition-colors"
            >
              ↺ Re-upload a different resume
            </button>
          </div>

          {/* Cluster scores card — v3.1.4 leads with radar shape, bars below for exact numbers */}
          <div className="col-span-8 bg-white border border-rule rounded-md shadow-card p-5">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">AI-extracted competency profile (C1–C8)</div>
            <div className="flex justify-center mb-4">
              <RadarChart
                size={300}
                series={[{
                  label: 'Your resume profile',
                  color: 'blue',
                  values: (['C1','C2','C3','C4','C5','C6','C7','C8'] as const).map((c) => profile.clusterScores[c] ?? 0),
                }]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['C1','C2','C3','C4','C5','C6','C7','C8'] as const).map(c => {
                const score = profile.clusterScores[c] ?? 0
                const conf = profile.clusterConfidence[c] ?? 0
                return (
                  <div key={c} className="flex items-center gap-2.5">
                    <span className="text-[10px] font-bold text-slate w-6">{c}</span>
                    <div className="flex-1 h-2 bg-cloud rounded-full overflow-hidden">
                      <div className={clsx('h-full rounded-full',
                        score >= 70 ? 'bg-green-700' : score >= 55 ? 'bg-amber-500' : 'bg-red-600'
                      )} style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-navy w-7 text-right">{score}</span>
                    <span
                      title={`Confidence ${conf.toFixed(2)} — derived from evidence count + recency`}
                      className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded border w-14 text-center',
                        conf >= 0.7 ? 'bg-green-50 text-green-700 border-green-200'
                        : conf >= 0.4 ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                      )}
                    >{conf >= 0.7 ? 'HIGH' : conf >= 0.4 ? 'MED' : 'LOW'}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-slate mt-3 leading-relaxed">
              Higher confidence = more resume evidence behind the score. Low confidence on a cluster doesn't mean you're weak — it means the resume didn't say much about it. The 3-way map below uses these scores as your "current" state.
            </p>
          </div>

          {/* Recommendations */}
          <div className="col-span-12">
            <h2 className="text-sm font-bold text-navy mb-3 mt-2">Career tracks recommended for you</h2>
            {recsQ.isLoading && <div className="text-slate text-sm">Computing fit across all tracks…</div>}
            {recsQ.data && recsQ.data.length === 0 && (
              <div className="bg-white border border-rule rounded-md p-6 text-center text-sm text-slate">
                No career tracks have aggregated demand data yet. Once employers upload JDs to a track, recommendations will appear here.
              </div>
            )}
            {recsQ.data && recsQ.data.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {recsQ.data.slice(0, 3).map((rec, i) => (
                  <div key={rec.careerTrackId} className={clsx(
                    'bg-white border rounded-md p-4 transition-all',
                    i === 0 ? 'border-accent ring-1 ring-accent/30' : 'border-rule'
                  )}>
                    {i === 0 && <div className="text-[9px] font-bold text-accent uppercase tracking-wider mb-1">★ Best fit</div>}
                    <div className="flex items-baseline gap-2 mb-1">
                      <h3 className="text-sm font-bold text-navy">{rec.careerTrackName}</h3>
                      <span className={clsx('text-base font-bold',
                        rec.fitPct >= 75 ? 'text-green-700' : rec.fitPct >= 55 ? 'text-amber-600' : 'text-red-600'
                      )}>{rec.fitPct}%</span>
                    </div>
                    <p className="text-[11px] text-slate mb-3 leading-relaxed">{rec.reasoning}</p>

                    {rec.topGapClusters.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[9px] font-semibold text-slate uppercase tracking-wider mb-1">Top gaps</div>
                        <div className="flex gap-1 flex-wrap">
                          {rec.topGapClusters.map(g => (
                            <span key={g.code} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                              {g.code} {g.resume}/{g.demand}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => navigate(`/path/${rec.careerTrackId}`)}
                      className="mt-3 w-full py-1.5 bg-navy text-white text-[11px] font-semibold rounded hover:bg-navy/90 transition-colors"
                    >
                      Open 3-way map →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* v3.1.9 — robust "Open 3-way map" button. Uses the top recommendation if
 * available; otherwise asks the API for the learner's primary career track
 * (always exists once enrolled) and routes to that. The earlier flow only
 * worked when the recs query had resolved with non-empty data, which on a
 * fresh DB / first-parse window briefly returned []. */
function PrimaryPathButton(
  { recommendations, navigate }: {
    recommendations: TrackRecommendation[]
    navigate: ReturnType<typeof useNavigate>
  },
) {
  // v3.1.10 — PRIMARY enrolled track wins. Recommendations only as a tie-break.
  // Earlier this picked recommendations[0] which could be ANY canonical track
  // (the one with the highest demand score) — NOT the track the learner is
  // enrolled in or the track Campus uploaded curriculum for. Result: 3-way
  // map showed empty data because curriculum was filed under a DIFFERENT
  // careerTrackId than the one we navigated to.
  const meQ = useQuery({
    queryKey: ['my-primary-track'],
    queryFn:  () => apiFetch<{ learner?: { careerTracks?: { id: string; name: string; isPrimary: boolean }[]; primaryCareerTrackId?: string | null } }>('/api/auth/me'),
    staleTime: 0,
    refetchOnMount: 'always',
  } as Parameters<typeof useQuery>[0]) as { data: { learner?: { careerTracks?: { id: string; name: string; isPrimary: boolean }[]; primaryCareerTrackId?: string | null } } | undefined }

  const primaryTrackId =
    meQ.data?.learner?.primaryCareerTrackId ??
    meQ.data?.learner?.careerTracks?.find((t) => t.isPrimary)?.id ??
    meQ.data?.learner?.careerTracks?.[0]?.id ??
    null
  const primaryTrackName =
    meQ.data?.learner?.careerTracks?.find((t) => t.id === primaryTrackId)?.name ?? ''

  // Primary enrolled track wins. If none (legacy learner), fall back to top recommendation.
  const target = primaryTrackId ?? recommendations[0]?.careerTrackId ?? null
  const labelTrackName = primaryTrackName || recommendations[0]?.careerTrackName || 'my track'

  return (
    <button
      onClick={() => target && navigate(`/path/${target}`)}
      disabled={!target}
      className="px-5 py-2.5 bg-navy text-white text-sm font-semibold rounded hover:bg-navy/90 transition-colors disabled:opacity-50 whitespace-nowrap flex-shrink-0"
    >Open 3-way map · {labelTrackName} →</button>
  )
}
