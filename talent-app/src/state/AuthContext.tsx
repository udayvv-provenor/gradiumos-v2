import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiFetch, clearTokens, setTokens } from '../lib/api'
import type { AuthTokens, User } from '../types'
interface AuthState { user: User | null; isLoading: boolean; login: (t: AuthTokens, u: User) => void; logout: () => void }
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    // 1) Hydrate from localStorage so the first paint isn't logged-out
    const s = localStorage.getItem('talent_user')
    if (s) { try { setUser(JSON.parse(s) as User) } catch { /* corrupted cache */ } }
    // 2) v3.1.7 — validate against /me. If the JWT is stale (user deleted,
    //    expired token, etc.), wipe local state so the sidebar / greeting /
    //    API calls don't show a phantom user.
    const tok = localStorage.getItem('accessToken')
    if (!tok) { setIsLoading(false); return }
    apiFetch<{ scope: string; user: { id: string; email: string; name: string }; learner?: { institutionName: string; careerTracks?: { name: string; isPrimary: boolean }[] } }>('/api/auth/me')
      .then((me) => {
        if (!me?.user) return
        // Adapt scoped /me payload → flat User used by Talent UI
        const primaryTrack = me.learner?.careerTracks?.find((t) => t.isPrimary)?.name ?? me.learner?.careerTracks?.[0]?.name ?? ''
        const flat: User = {
          id:              me.user.id,
          email:           me.user.email,
          name:            me.user.name,
          institutionName: me.learner?.institutionName ?? '',
          track:           primaryTrack,
          inviteCode:      '',
        }
        localStorage.setItem('talent_user', JSON.stringify(flat))
        setUser(flat)
      })
      .catch(() => {
        clearTokens()
        localStorage.removeItem('talent_user')
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])
  const login = useCallback((tokens: AuthTokens, u: User) => { setTokens(tokens); localStorage.setItem('talent_user', JSON.stringify(u)); setUser(u) }, [])
  const logout = useCallback(() => { clearTokens(); localStorage.removeItem('talent_user'); setUser(null); window.location.href = '/login' }, [])
  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
