import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from '../components/Toast'
import { useAuth } from '../state/AuthContext'
import type { Learner } from '../types'

/* v3.1.1 — Add-Learner UI added per user QA feedback.
 *
 * Two paths to roster a learner:
 *   1) Dean clicks "+ Add learner" → enters name + email → backend creates
 *      Learner+User row with a generated temporary password ("Welcome1234!")
 *      that the Dean copies and shares.
 *   2) Dean shares the institution invite code; learner self-signs up via
 *      Talent portal /signup. (Existing flow — invite-code panel still here.)
 */
interface CreateLearnerResponse {
  id: string; name: string; email: string; trackName: string
  tempPassword: string; joinedAt: string
}

export default function Learners() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '' })
  const [justAdded, setJustAdded] = useState<CreateLearnerResponse | null>(null)
  const [credCopied, setCredCopied] = useState(false)

  const { data: learners = [], isLoading } = useQuery<Learner[]>({
    queryKey: ['campus-learners'],
    queryFn: () => apiFetch('/api/campus/learners'),
  } as any)

  // v3.1.1 — fetch invite code from server (was previously read from
  // user.inviteCode which is null after a /login flow). API source is reliable.
  const { data: institution } = useQuery<{ id: string; name: string; inviteCode: string }>({
    queryKey: ['campus-institution'],
    queryFn: () => apiFetch('/api/campus/me/institution'),
  } as any)

  const addMutation = useMutation<CreateLearnerResponse, Error, { name: string; email: string }>({
    mutationFn: data => apiFetch('/api/campus/learners', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: (res) => {
      setJustAdded(res)
      setForm({ name: '', email: '' })
      qc.invalidateQueries({ queryKey: ['campus-learners'] })
      qc.invalidateQueries({ queryKey: ['campus-kpis'] })
    },
    onError: e => showToast(e.message),
  })

  // v3.1.1 — prefer server-fetched value; fall back to AuthContext user (signup flow).
  const inviteCode = institution?.inviteCode ?? user?.inviteCode ?? '—'

  function handleCopyInvite() {
    const text = `Join our institution on GradiumOS. At signup, enter invite code: ${inviteCode}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleCopyCreds() {
    if (!justAdded) return
    const text = `GradiumOS Talent — ${justAdded.email} / ${justAdded.tempPassword} (login at http://localhost:5277/login and change password)`
    navigator.clipboard.writeText(text).then(() => {
      setCredCopied(true)
      setTimeout(() => setCredCopied(false), 2000)
    })
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) { showToast('Name and email required'); return }
    addMutation.mutate({ name: form.name.trim(), email: form.email.trim() })
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-[19px] font-bold text-navy">Learners</h1>
          <p className="text-xs text-slate mt-0.5">{learners.length} learner{learners.length === 1 ? '' : 's'} enrolled across all tracks</p>
        </div>
        <div className="flex gap-3">
          {/* + Add learner CTA */}
          <button
            onClick={() => { setShowAdd(true); setJustAdded(null) }}
            className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors flex-shrink-0 self-start"
          >
            + Add learner
          </button>
          {/* Invite code card */}
          <div className="bg-white rounded-md border border-rule shadow-card p-4 min-w-[260px]">
            <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Or share invite code</div>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-lg font-bold text-navy tracking-widest">{inviteCode}</span>
            </div>
            <p className="text-[10px] text-slate mb-3 leading-relaxed">
              Learners enter this at signup to join your institution.
            </p>
            <button
              onClick={handleCopyInvite}
              className="w-full py-1.5 text-xs font-semibold rounded border border-rule bg-cloud hover:bg-rule transition-colors"
            >
              {copied ? '✓ Copied!' : 'Copy invite message'}
            </button>
          </div>
        </div>
      </div>

      {/* Add-learner inline form */}
      {showAdd && !justAdded && (
        <div className="bg-white rounded-md border border-rule shadow-card p-5 mb-5 max-w-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-navy">Add a learner</h2>
            <button onClick={() => setShowAdd(false)} className="text-xs text-slate hover:text-navy">✕</button>
          </div>
          <form onSubmit={submitAdd} className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-navy mb-1">Learner name</label>
              <input
                type="text" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Aditi Sharma"
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy mb-1">Email</label>
              <input
                type="email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="aditi@yourinstitution.edu"
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent"
              />
            </div>
            <p className="text-[10px] text-slate leading-snug">
              We'll generate a temporary password for you to share with the learner. They can change it after first login.
            </p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setShowAdd(false)} className="flex-1 py-2 text-xs font-semibold border border-rule rounded hover:bg-cloud">Cancel</button>
              <button type="submit" disabled={addMutation.isPending} className="flex-1 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark disabled:opacity-60">
                {addMutation.isPending ? 'Adding…' : 'Add learner'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Just-added confirmation with creds */}
      {justAdded && (
        <div className="bg-green-50 border border-green-200 rounded-md p-5 mb-5 max-w-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-green-700 font-bold">✓</span>
            <h2 className="text-sm font-bold text-navy">Learner added: {justAdded.name}</h2>
          </div>
          <p className="text-xs text-slate mb-3">Share these credentials with the learner. They can change the password after logging in.</p>
          <div className="bg-white border border-rule rounded p-3 mb-3 font-mono text-xs">
            <div><span className="text-slate">Login:</span> <span className="text-navy font-bold">http://localhost:5277/login</span></div>
            <div><span className="text-slate">Email:</span> <span className="text-navy font-bold">{justAdded.email}</span></div>
            <div><span className="text-slate">Password:</span> <span className="text-navy font-bold">{justAdded.tempPassword}</span></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCopyCreds} className="flex-1 py-2 text-xs font-semibold border border-green-300 bg-white rounded hover:bg-green-100 transition-colors">
              {credCopied ? '✓ Copied!' : 'Copy login details'}
            </button>
            <button onClick={() => { setJustAdded(null); setShowAdd(true) }} className="flex-1 py-2 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark">
              + Add another
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="bg-white rounded-md border border-rule shadow-card p-8 text-center text-slate text-sm">
          Loading learners…
        </div>
      )}

      {!isLoading && learners.length === 0 && !showAdd && !justAdded && (
        <div className="bg-white rounded-md border border-rule shadow-card p-12 text-center">
          <div className="text-3xl mb-3 opacity-30">◎</div>
          <div className="text-sm font-semibold text-navy mb-1">No learners yet</div>
          <p className="text-xs text-slate max-w-sm mx-auto">
            Click <strong className="text-navy">+ Add learner</strong> above to roster one directly, or share your invite code so learners can self-sign-up.
          </p>
        </div>
      )}

      {learners.length > 0 && (
        <div className="bg-white rounded-md border border-rule shadow-card overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Learner', 'Email', 'Track', 'Readiness', 'Joined'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[9.5px] font-semibold text-slate uppercase tracking-wide border-b border-rule bg-cloud">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {learners.map(l => (
                <tr key={l.id} className="border-b border-rule last:border-0 hover:bg-cloud/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                        {l.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="font-medium text-navy">{l.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate">{l.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-light text-accent">
                      {l.trackName}
                    </span>
                  </td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-slate text-xs">{new Date(l.joinedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
