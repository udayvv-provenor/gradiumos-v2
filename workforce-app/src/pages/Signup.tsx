import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { postSignupEmployer } from '../lib/api'

/* v3.1 — Company Archetype dropdown REMOVED.
 *
 * v3.1.1 (Uday's call) — we don't even derive a COMPANY-level archetype anymore.
 * A company has many roles; each role has its own archetype (Razorpay has
 * Product engineering, Service support, AND MassRecruiter Genc fresher hiring
 * all simultaneously — collapsing to a single label is a lie). Archetype is
 * a per-ROLE property, extracted from each JD on upload and shown on the role
 * detail page only. No company-level chip, no signup explainer.
 */

export default function Signup() {
  const { login } = useAuth(); const navigate = useNavigate()
  const [form, setForm] = useState({ employerName: '', email: '', password: '', name: '' })
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!agreedToTerms) { setError('Please accept the Privacy Policy and Terms of Service to continue.'); return }
    setLoading(true)
    try {
      const res = await postSignupEmployer(form)
      login(res.tokens, res.user); navigate('/dashboard')
    } catch (err) { setError(err instanceof Error ? err.message : 'Signup failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-cloud flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-accent rounded-md flex items-center justify-center text-lg font-bold text-white shadow-[0_2px_8px_rgba(124,58,237,0.4)]">G</div>
            <div className="text-left"><div className="text-sm font-bold text-navy">GradiumOS</div><div className="text-xs text-accent font-medium">Workforce Portal</div></div>
          </div>
          <h1 className="text-xl font-bold text-navy">Create employer account</h1>
          <p className="text-sm text-slate mt-1">Join GradiumOS Workforce to discover talent</p>
        </div>
        <div className="bg-white rounded-lg border border-rule shadow-card p-6">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            {[
              { key: 'employerName', label: 'Company Name', type: 'text', placeholder: 'Freshworks' },
              { key: 'name', label: 'Your Name', type: 'text', placeholder: 'Sarita Rajan' },
              { key: 'email', label: 'Work Email', type: 'email', placeholder: 'ta@company.com' },
              { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
            ].map(({ key, label, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-navy mb-1.5">{label}</label>
                <input type={type} required value={form[key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                  className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors" />
              </div>
            ))}
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={agreedToTerms} onChange={e => setAgreedToTerms(e.target.checked)} className="mt-0.5 accent-accent" />
              <span className="text-xs text-slate">
                I agree to the{' '}
                <a href="https://gradiumos-demo-landing.vercel.app/#/privacy" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Privacy Policy</a>
                {' '}and{' '}
                <a href="https://gradiumos-demo-landing.vercel.app/#/terms" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Terms of Service</a>.
                By signing up I consent to GradiumOS processing hiring data as described.
              </span>
            </label>
            <button type="submit" disabled={loading || !agreedToTerms} className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60 mt-1">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <p className="text-center text-xs text-slate mt-4">Already registered? <Link to="/login" className="text-accent font-medium hover:underline">Sign in</Link></p>
        </div>
      </div>
    </div>
  )
}
