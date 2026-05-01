import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import clsx from 'clsx'

interface AiStatus { groq: { configured: boolean; model: string|null }; serper: { configured: boolean }; mode: 'live'|'live-ai-only'|'live-serper-only'|'fallback' }

// v3.1.9 — standalone "AI Tutor" REMOVED. Augmentation happens INSIDE Learn
// (Lesson stream is the gap-driven tutor surface) and INSIDE Shift (in-context
// partner drawer). Free-form chat would let learners drift away from gap-closing.
const NAV = [
  { to: '/dashboard',     label: 'Dashboard',      icon: '⊞' },
  { to: '/market',        label: 'Market Intel',   icon: '◷' },
  { to: '/profile',       label: 'Profile',        icon: '◉' },
  { to: '/portfolio',     label: 'Portfolio',      icon: '⬡' },
  { to: '/learn',         label: 'Learn',          icon: '◊' },
  { to: '/assessments',   label: 'Assessments',    icon: '✎' },
  { to: '/opportunities', label: 'Opportunities',  icon: '⚡' },
  { to: '/applications',  label: 'Applications',   icon: '◳' },
]

interface SidebarProps {
  bellSlot?: ReactNode
}

export function Sidebar({ bellSlot }: SidebarProps) {
  const { user, logout } = useAuth()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() ?? 'U'

  // v3.1.6 — system AI status. Polled every 60s. Shows live-vs-fallback honestly.
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => apiFetch<AiStatus>('/api/system/ai-status'),
    refetchInterval: 60_000,
    enabled: !!user,
  } as Parameters<typeof useQuery>[0]) as { data: AiStatus | undefined }

  // v3.1.7 — surface any in-progress shift for cross-device resume
  const activeShift = useQuery({
    queryKey: ['shift-active'],
    queryFn: () => apiFetch<{ active: { id: string; scenarioCompany: string | null; startedAt: string } | null }>('/api/talent/me/shift/active'),
    refetchInterval: 30_000,
    enabled: !!user,
  } as Parameters<typeof useQuery>[0]) as { data: { active: { id: string; scenarioCompany: string | null; startedAt: string } | null } | undefined }
  const inProgress = activeShift.data?.active ?? null

  // v3.1.7 — real Signal state (replaces hardcoded "Ready to Generate")
  const signalQ = useQuery({
    queryKey: ['signal-status'],
    queryFn: () => apiFetch<{ band: string; score: number; unlocked: boolean }>('/api/talent/me/signal'),
    refetchInterval: 60_000,
    enabled: !!user,
  } as Parameters<typeof useQuery>[0]) as { data: { band: string; score: number; unlocked: boolean } | undefined }
  const signal = signalQ.data
  const mode = status.data?.mode ?? 'fallback'
  const dotColor = mode === 'live' ? 'bg-green-400' : mode === 'fallback' ? 'bg-red-400' : 'bg-amber-400'
  const label = mode === 'live' ? 'Live AI + Serper' : mode === 'live-ai-only' ? 'Live AI · Serper offline' : mode === 'live-serper-only' ? 'Serper · AI offline' : 'Fallback (mocks)'
  return (
    <aside className="w-60 bg-navy flex flex-col flex-shrink-0 overflow-y-auto z-10" aria-label="Main navigation">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="text-[15px] font-bold text-white mb-0.5">
          GradiumOS<span className="text-gold mx-1.5">│</span><span className="text-accent font-normal">Talent</span>
        </div>
        <div className="text-[10px] text-white/40 tracking-[0.3px]">Turning learning into verifiable competence.</div>
        {user && (
          <div className="mt-3 bg-accent/20 border border-accent/30 rounded-lg px-3 py-2.5">
            <div className="text-[10px] text-white/50 uppercase tracking-[0.8px] mb-1">GradiumOS Signal</div>
            {signal ? (
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className={clsx('flex items-center gap-1.5', signal.band === 'gold' ? 'text-amber-300' : signal.band === 'silver' ? 'text-slate-200' : signal.band === 'bronze' ? 'text-orange-300' : 'text-white/60')}>
                  <span className={clsx('w-1.5 h-1.5 rounded-full', signal.unlocked ? 'bg-accent animate-pulse' : 'bg-white/40')} />
                  {signal.band === 'locked' ? 'Locked' : `${signal.band.charAt(0).toUpperCase()}${signal.band.slice(1)}`}
                </span>
                <span className="text-white/70 tabular-nums">{signal.score}</span>
              </div>
            ) : (
              <div className="text-xs text-white/50">Loading…</div>
            )}
          </div>
        )}
        {/* v3.1.7 — in-progress shift resume chip */}
        {inProgress && (
          <NavLink to="/shift" className="mt-2 block bg-amber-500/20 border border-amber-400/40 rounded-lg px-3 py-2 hover:bg-amber-500/30 transition-colors">
            <div className="text-[9px] text-amber-200/80 uppercase tracking-wider font-bold mb-0.5">Shift in progress</div>
            <div className="text-[11px] text-white font-semibold truncate">{inProgress.scenarioCompany ?? 'Untitled'} → resume</div>
          </NavLink>
        )}
      </div>
      <nav className="flex-1 py-3">
        <div className="px-5 mb-1 text-[10px] text-white/30 uppercase tracking-[0.8px] pt-2">Overview</div>
        {NAV.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => clsx(
            'flex items-center gap-2.5 px-5 py-2.5 text-[13px] font-medium border-l-[3px] transition-all duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400',
            isActive ? 'text-white bg-accent/15 border-l-accent' : 'text-white/60 border-l-transparent hover:text-white hover:bg-white/[0.06]'
          )}>
            <span className="text-sm w-4 text-center">{icon}</span>{label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-[34px] h-[34px] rounded-full bg-accent flex items-center justify-center font-bold text-[13px] text-white flex-shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user?.name ?? '—'}</div>
            <div className="text-[10px] text-white/40 truncate">{user?.track} · {user?.institutionName}</div>
          </div>
          {bellSlot}
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-white/50" title={`Mode: ${mode}${status.data?.groq.model ? ' · ' + status.data.groq.model : ''}`}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', dotColor, mode === 'live' ? 'animate-pulse' : '')} />
          <span className="truncate">{label}</span>
        </div>
        <button onClick={logout} className="mt-2 text-[10px] text-white/30 hover:text-white/60 transition-colors w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">Logout</button>
      </div>
    </aside>
  )
}
