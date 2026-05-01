import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { TrackPicker } from '../components/TrackPicker'
import type { CareerTrack } from '../types'

/* v3.1 — Career Track creation form.
 *
 * REMOVED:
 *  - Track-level archetype dropdown. A career track is a curriculum container
 *    ("B.Tech CSE", "M.Tech AI"). It has NO single archetype — graduates of a
 *    CSE track place into Product, Service, AND MassRecruiter roles. Asking
 *    the Dean to pick one was a leak of GradiumOS internal taxonomy.
 *  - Free-text "Track Code" field. The Dean was being asked to invent a code
 *    like "BE-2025" — but the backend requires a CANONICAL career-track code
 *    (one of: SWE / DATA / OPS / CUSTSUCCESS / FINTECH / MLAI / PRODUCT /
 *    DESIGN). The free-text input was guaranteed to fail validation.
 *
 * REPLACED with:
 *  - Track Name (free text — the institution's own naming, "B.Tech CSE")
 *  - Maps to canonical: dropdown of the 8 canonical tracks, so the Dean
 *    binds their named track to the shared vocabulary the rest of the
 *    platform uses.
 *
 * The archetype MIX surfaces later as an OUTPUT on Gap Report, derived from
 * which employer roles target this track.
 */

export default function CareerTrackNew() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [form, setForm] = useState<{ name: string; canonicalTrackId: string; canonicalTrackName: string }>({
    name: '', canonicalTrackId: '', canonicalTrackName: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // v3.1.2 — Campus track creation now picks from the SHARED platform catalogue
  // (or creates a new entry inline via TrackPicker). The institution names the
  // track ("B.Tech CSE") and links it to the platform-wide canonical entry by
  // CODE — but that code is now whatever the matched/created CareerTrack's
  // code is, not a hard-coded list of 8.
  const mutation = useMutation<CareerTrack, Error, { name: string; careerTrackCode: string }>({
    mutationFn: data => apiFetch('/api/campus/career-tracks', {
      method: 'POST',
      body: JSON.stringify({ name: data.name, careerTrackCode: data.careerTrackCode }),
    }),
    onSuccess: track => {
      // v3.1.1 — also invalidate the dashboard KPIs (track count) and gap
      // queries so when the Dean lands back on /dashboard the numbers refresh.
      qc.invalidateQueries({ queryKey: ['career-tracks'] })
      qc.invalidateQueries({ queryKey: ['campus-kpis'] })
      qc.invalidateQueries({ queryKey: ['campus-gaps'] })
      showToast('Track created — upload curriculum next to map to C1–C8.', 'success')
      navigate(`/career-tracks/${track.id}`)
    },
    onError: e => showToast(e.message),
  })

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Track name is required'
    if (!form.canonicalTrackId) e.careerTrackCode = 'Pick the platform career track this maps to (or create a new one)'
    return e
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    // Backend's POST /api/campus/career-tracks expects `careerTrackCode` (not id)
    // — derive code from the picked TrackPicker entry. We carry name in state
    // for convenience but only need to send the code.
    // Look up the code from the canonical-track id we stored (the TrackPicker
    // returned both id and name, but we need the canonical CODE; fetch quickly).
    apiFetch<Array<{ id: string; code: string; name: string }>>(`/api/career-tracks/search?q=`)
      .then(rs => {
        const m = rs.find(r => r.id === form.canonicalTrackId)
        if (!m) { showToast('Could not resolve picked track — please re-pick'); return }
        mutation.mutate({ name: form.name, careerTrackCode: m.code })
      })
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => navigate('/career-tracks')} className="text-slate text-sm hover:text-navy transition-colors">
          ← Career Tracks
        </button>
        <span className="text-slate">/</span>
        <span className="text-sm font-semibold text-navy">New Track</span>
      </div>

      <h1 className="text-[19px] font-bold text-navy mb-1">Create career track</h1>
      <p className="text-xs text-slate mb-6">A career track is your curriculum container — what your students study (e.g. "B.Tech CSE"). Map it to one of GradiumOS's canonical tracks so demand from employers across the network can flow through.</p>

      <div className="bg-white rounded-md border border-rule shadow-card p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-navy mb-1.5">Track Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder='e.g. "B.Tech Computer Science & Engineering"'
              className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-[10px] text-slate mt-1">Whatever your institution calls this programme.</p>
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy mb-1.5">Maps to platform career track</label>
            <TrackPicker
              value={form.canonicalTrackId ?? ''}
              onChange={(id, name) => setForm(f => ({ ...f, canonicalTrackId: id, canonicalTrackName: name }))}
              placeholder="Search the catalogue or type a new track name…"
              errorMsg={errors.careerTrackCode}
            />
            <p className="text-[10px] text-slate mt-1">Tracks are dynamic — pick from the platform catalogue or create a new one inline. Lets employers' demand on the same track (across the whole platform) flow into your Gap Report.</p>
          </div>

          <div className="bg-accent-light/40 border border-accent/30 rounded-md p-3 text-[11px] text-ink leading-relaxed">
            <strong className="text-accent">Next:</strong> on the track detail page, paste or upload your curriculum (syllabus / course outline). GradiumOS extracts subject-level cluster coverage automatically. The archetype mix surfaces on the Gap Report once roles target this track — you don't pick it.
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate('/career-tracks')}
              className="flex-1 py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60"
            >
              {mutation.isPending ? 'Creating…' : 'Create track →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
