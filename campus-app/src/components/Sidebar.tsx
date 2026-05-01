import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import clsx from 'clsx'

const NAV = [
  { to: '/dashboard',     label: 'Dashboard',     icon: <GridIcon /> },
  { to: '/market',        label: 'Market Intel',  icon: <MarketIcon /> },
  { to: '/career-tracks', label: 'Career Tracks', icon: <TracksIcon /> },
  { to: '/learners',      label: 'Learners',      icon: <LearnersIcon /> },
]

function MarketIcon() {
  return <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 16 16"><path d="M1 14h14M3 11l3-4 3 3 4-6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function GridIcon() {
  return <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity=".7"/></svg>
}
function TracksIcon() {
  return <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 16 16"><path d="M2 14V6l3-4 3 3 3-2 3 2v9H2z" stroke="currentColor" strokeWidth="1.3"/></svg>
}
function LearnersIcon() {
  return <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 16 16"><circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M1 14c0-3.3 2.2-5 5-5s5 1.7 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M12 6v4M10 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}

interface SidebarProps { bellSlot?: ReactNode }

export function Sidebar({ bellSlot }: SidebarProps) {
  const { user, logout } = useAuth()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? 'U'

  return (
    <aside className="w-60 bg-navy flex flex-col flex-shrink-0 overflow-y-auto z-10">
      {/* Logo */}
      <div className="px-5 py-[22px] border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-accent rounded-[6px] flex items-center justify-center text-base font-bold text-white flex-shrink-0">G</div>
          <div>
            <div className="flex items-center">
              <span className="text-[13px] font-bold text-white tracking-[0.2px]">GradiumOS</span>
              <span className="inline-block w-px h-3 bg-gold mx-1.5 opacity-90" />
              <span className="text-[13px] font-medium text-accent">Campus</span>
            </div>
          </div>
        </div>
        {user && (
          <>
            <div className="mt-2.5 text-[10px] text-white/40 uppercase tracking-[0.3px] font-normal">Institution</div>
            <div className="text-[11px] text-white/80 font-medium mt-0.5 leading-snug">{user.institutionName}</div>
          </>
        )}
      </div>

      {/* Nav — v3.1.1: standardised Tailwind opacity values (Tailwind silently
          drops non-standard /55 /85 /82 /38 /25 etc., causing dark-text-on-dark
          rendering at bottom of sidebar). */}
      <nav className="flex-1 py-2.5">
        <div className="px-5 py-3.5 pb-1 text-[9px] font-semibold text-white/30 uppercase tracking-[1.2px]">Navigation</div>
        {NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-5 py-2 text-[12.5px] font-normal border-l-2 transition-all duration-100 select-none',
              isActive
                ? 'bg-accent/20 border-l-accent text-white font-medium'
                : 'border-l-transparent text-white/60 hover:bg-white/5 hover:text-white/90'
            )}
          >
            <span className={clsx('opacity-70')}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User footer — v3.1.1: white/82 → white/80 (Tailwind doesn't have /82) */}
      <div className="px-5 py-3.5 border-t border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-full bg-accent flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-white/80 truncate">{user?.name ?? '—'}</div>
            <button
              onClick={logout}
              className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
            >
              Logout
            </button>
          </div>
          {bellSlot}
        </div>
      </div>
    </aside>
  )
}
