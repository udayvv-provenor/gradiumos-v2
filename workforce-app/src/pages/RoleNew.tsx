import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { TrackPicker } from '../components/TrackPicker'
import type { Role } from '../types'

/**
 * v3.1 — Role creation form.
 *
 * REMOVED:
 *  - Archetype dropdown (Product/Service/MassRecruiter). The TA Lead doesn't
 *    classify; Groq extracts archetype from the JD when it's uploaded.
 *  - Manual cluster weights / cluster targets editor (was never even surfaced
 *    in the v3 UI; backend now defaults from parent CareerTrack and lets the
 *    JD upload overwrite. Advanced override available via direct API.)
 *
 * KEPT (sensible inputs the TA actually knows):
 *  - Role Title (free text)
 *  - Career Track (dropdown — which track of learners this role recruits from)
 *  - Seats Planned (OPTIONAL — defaults to 1, can be left blank pre-HR-signoff
 *    or refined after JD upload if the JD names volume)
 *
 * NEXT STEP after create: the user lands on /roles/:id and is prompted to
 * upload the JD. That single action derives archetype + cluster targets +
 * requirements + (potentially) seat-count refinement.
 */

export default function RoleNew() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  // v3.1.1 — accept ?track=<id> deep-link from the per-track "+ Role under
  // this track" CTA on /roles, so the typeahead is pre-selected.
  const [searchParams] = useSearchParams()
  const prefillTrack = searchParams.get('track') ?? ''
  const [form, setForm] = useState<{ title: string; careerTrackId: string; seatsPlanned: number | '' }>({
    title: '',
    careerTrackId: prefillTrack,
    seatsPlanned: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation<Role, Error, { title: string; careerTrackId: string; seatsPlanned?: number }>({
    mutationFn: data => apiFetch('/api/workforce/roles', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: role => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      showToast('Role created — upload the JD next so we can extract cluster targets', 'success')
      navigate(`/roles/${role.id}`)
    },
    onError: e => showToast(e.message),
  })

  function validate() {
    const e: Record<string, string> = {}
    if (!form.title.trim()) e.title = 'Role title is required'
    if (!form.careerTrackId) e.careerTrackId = 'Pick which career track this role hires from'
    if (form.seatsPlanned !== '' && form.seatsPlanned < 1) e.seatsPlanned = 'Must be at least 1, or leave blank'
    return e
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    mutation.mutate({
      title: form.title,
      careerTrackId: form.careerTrackId,
      ...(form.seatsPlanned !== '' ? { seatsPlanned: form.seatsPlanned } : {}),
    })
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <button onClick={() => navigate('/roles')} className="text-slate hover:text-navy transition-colors">← Career Tracks</button>
        <span className="text-slate">/</span>
        <span className="font-semibold text-navy">Post a role</span>
      </div>

      <h1 className="text-[19px] font-bold text-navy mb-1">Post a role under a career track</h1>
      <p className="text-xs text-slate mb-6">
        <strong className="text-navy">Step 1.</strong> Pick (or create) the career track this role hires from.
        <strong className="text-navy"> Step 2.</strong> Title the role.
        <strong className="text-navy"> Step 3.</strong> Upload the JD on the next screen — AI derives cluster targets, archetype, and requirements.
      </p>

      <div className="bg-white rounded-md border border-rule shadow-card p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* v3.1.7 — Career Track FIRST per Uday: select track THEN role THEN JD */}
          <div>
            <label className="block text-xs font-semibold text-navy mb-1.5">
              <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-accent text-white mr-2">Step 1</span>
              Career Track
            </label>
            <TrackPicker
              value={form.careerTrackId}
              onChange={(id) => setForm(f => ({ ...f, careerTrackId: id }))}
              placeholder="Search the catalogue or type a new track name…"
              errorMsg={errors.careerTrackId}
            />
            <p className="text-[10px] text-slate mt-1">Tracks are dynamic — pick from the platform catalogue or create a new one inline. AI maps any new track to the GradiumOS cluster vocabulary (C1–C8).</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy mb-1.5">
              <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-accent text-white mr-2">Step 2</span>
              Role Title
            </label>
            <input
              type="text" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Senior Backend Engineer"
              className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
            />
            {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-navy mb-1.5">
              Seats Planned <span className="text-slate font-normal">— optional</span>
            </label>
            <input
              type="number" min={1} value={form.seatsPlanned}
              onChange={e => {
                const v = e.target.value
                setForm(f => ({ ...f, seatsPlanned: v === '' ? '' : (parseInt(v) || 1) }))
              }}
              placeholder="Leave blank if not yet decided"
              className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
            />
            <p className="text-[10px] text-slate mt-1">If the JD says a number ("hiring 12 SDEs"), we'll pick it up on upload.</p>
            {errors.seatsPlanned && <p className="text-xs text-red-600 mt-1">{errors.seatsPlanned}</p>}
          </div>

          <div className="bg-accent-light/40 border border-accent/30 rounded-md p-3 text-[11px] text-ink leading-relaxed">
            <strong className="text-accent">Next:</strong> upload your job description (paste or PDF). GradiumOS extracts the cluster targets (C1–C8), the archetype, the required skills, and the seniority — all automatically. No manual scoring.
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => navigate('/roles')} className="flex-1 py-2.5 bg-white text-ink text-sm font-semibold rounded border border-rule hover:bg-cloud transition-colors">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60">
              {mutation.isPending ? 'Creating…' : 'Create role →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
