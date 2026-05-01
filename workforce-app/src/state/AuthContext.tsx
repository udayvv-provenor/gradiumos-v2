import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiFetch, clearTokens, setTokens } from '../lib/api'
import type { AuthTokens, User } from '../types'

interface AuthState { user: User | null; isLoading: boolean; login: (t: AuthTokens, u: User) => void; logout: () => void }
const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    const s = localStorage.getItem('workforce_user')
    if (s) { try { setUser(JSON.parse(s) as User) } catch { /* corrupt */ } }
    const tok = localStorage.getItem('accessToken')
    if (!tok) { setIsLoading(false); return }
    apiFetch<{ scope: string; user: { id: string; email: string; name: string }; employer?: { name: string } }>('/api/auth/me')
      .then((me) => {
        if (!me?.user) return
        const flat = {
          id:           me.user.id,
          email:        me.user.email,
          name:         me.user.name,
          employerName: me.employer?.name ?? '',
        } as unknown as User
        localStorage.setItem('workforce_user', JSON.stringify(flat))
        setUser(flat)
      })
      .catch(() => {
        clearTokens(); localStorage.removeItem('workforce_user'); setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])
  const login = useCallback((tokens: AuthTokens, u: User) => {
    setTokens(tokens); localStorage.setItem('workforce_user', JSON.stringify(u)); setUser(u)
  }, [])
  const logout = useCallback(() => {
    clearTokens(); localStorage.removeItem('workforce_user'); setUser(null); window.location.href = '/login'
  }, [])
  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
