import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { postLogin, postSignupLearner } from '../lib/api'

/* v3.1.3 — Talent access is INVITE-ONLY. Two paths:
 *  (a) Dean added you via Campus → Learners → got temp password → just sign in
 *  (b) Dean shared the institution invite code → click "Got an invite code?"
 *      below → enter name+email+password+code → join your institution
 *
 * No public Talent signup form exists. Talent access is granted by the
 * institution; this matches how every real bootcamp / university works. */

export default function Login() {
  const { login } = useAuth(); const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'login' | 'invite'>('login')
  const [invForm, setInvForm] = useState({ name: '', email: '', password: '', inviteCode: '' })

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await postLogin(form)
      login(res.tokens, res.user); navigate('/dashboard')
    } catch (err) { setError(err instanceof Error ? err.message : 'Login failed') }
    finally { setLoading(false) }
  }
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const res = await postSignupLearner(invForm)
      login(res.tokens, res.user); navigate('/dashboard')
    } catch (err) { setError(err instanceof Error ? err.message : 'Invite redemption failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-cloud flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-accent rounded-md flex items-center justify-center text-lg font-bold text-white">G</div>
            <div className="text-left"><div className="text-sm font-bold text-navy">GradiumOS</div><div className="text-xs text-accent font-medium">Talent Portal</div></div>
          </div>
          <h1 className="text-xl font-bold text-navy">{mode === 'login' ? 'Welcome back' : 'Join your institution'}</h1>
          <p className="text-sm text-slate mt-1">
            {mode === 'login'
              ? 'Sign in with the credentials your institution shared.'
              : 'Enter the 8-char invite code from your institution to bind your account.'}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-rule shadow-card p-6">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Email</label>
                <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors" placeholder="you@email.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Password</label>
                <input type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors" placeholder="••••••••" />
              </div>
              <button type="submit" disabled={loading} className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleInvite} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Your Name</label>
                <input type="text" required value={invForm.name} onChange={e => setInvForm(f => ({ ...f, name: e.target.value }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent" placeholder="Aditi Sharma" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Email</label>
                <input type="email" required value={invForm.email} onChange={e => setInvForm(f => ({ ...f, email: e.target.value }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent" placeholder="you@yourinstitution.edu" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Password</label>
                <input type="password" required value={invForm.password} onChange={e => setInvForm(f => ({ ...f, password: e.target.value }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent" placeholder="At least 8 characters" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-navy mb-1.5">Invite Code</label>
                <input type="text" required minLength={8} maxLength={8} value={invForm.inviteCode} onChange={e => setInvForm(f => ({ ...f, inviteCode: e.target.value.toUpperCase() }))} className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent font-mono tracking-widest" placeholder="ABCD1234" />
              </div>
              <button type="submit" disabled={loading} className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60">
                {loading ? 'Joining…' : 'Join institution'}
              </button>
            </form>
          )}
          <p className="text-center text-xs text-slate mt-4">
            {mode === 'login' ? (
              <>Got an invite code? <button onClick={() => { setMode('invite'); setError(''); }} className="text-accent font-medium hover:underline">Redeem here</button></>
            ) : (
              <>Already registered? <button onClick={() => { setMode('login'); setError(''); }} className="text-accent font-medium hover:underline">Sign in</button></>
            )}
          </p>
        </div>
        <p className="text-center text-[10px] text-slate mt-4 leading-relaxed max-w-xs mx-auto">
          Talent access is invite-only. Your institution either added you directly (use the temp password they shared) or gave you an invite code.
        </p>
      </div>
    </div>
  )
}
