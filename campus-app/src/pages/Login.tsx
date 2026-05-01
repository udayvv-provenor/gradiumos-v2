import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { postLogin } from '../lib/api'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await postLogin(form)
      login(res.tokens, res.user)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cloud flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 bg-accent rounded-md flex items-center justify-center text-lg font-bold text-white">G</div>
            <div className="text-left">
              <div className="text-sm font-bold text-navy">GradiumOS</div>
              <div className="text-xs text-accent font-medium">Campus Portal</div>
            </div>
          </div>
          <h1 className="text-xl font-bold text-navy">Welcome back</h1>
          <p className="text-sm text-slate mt-1">Sign in to your institution account</p>
        </div>

        <div className="bg-white rounded-lg border border-rule shadow-card p-6">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
                placeholder="dean@institution.edu"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">Password</label>
              <input
                type="password"
                required
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="text-center text-xs text-slate mt-4">
            New institution?{' '}
            <Link to="/signup" className="text-accent font-medium hover:underline">Create account</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
