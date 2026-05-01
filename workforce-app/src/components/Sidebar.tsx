import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../state/AuthContext'
import clsx from 'clsx'

/* v3.1.1 — DerivedArchetypeChip removed. Per Uday's call: archetype is a
 * per-ROLE property, not a per-company aggregation. Razorpay has Product +
 * Service + MassRecruiter roles simultaneously; collapsing them to a single
 * label is misleading. The chip lives only on the Role detail page now. */

const NAV = [
  { to: '/dashboard', label: 'Dashboard',     icon: '⊞' },
  { to: '/market',    label: 'Market Intel',  icon: '◷' },
  // v3.1.1 — renamed: the page is already track-grouped (each role lives under
  // a canonical Career Track). Naming the nav item "Career Tracks" matches the
  // mental model: pick a track first, then post a role under it.
  { to: '/roles',     label: 'Career Tracks', icon: '◫' },
]

interface SidebarProps { bellSlot?: ReactNode }

export function Sidebar({ bellSlot }: SidebarProps) {
  const { user, logout } = useAuth()
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? 'U'
  return (
    <aside className="w-60 bg-navy flex flex-col flex-shrink-0 overflow-y-auto z-10">
      <div className="px-[18px] py-5 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="w-8 h-8 bg-accent rounded-[7px] flex items-center justify-center text-base font-bold text-white flex-shrink-0 shadow-[0_2px_8px_rgba(124,58,237,0.4)]">G</div>
          <div className="flex items-center">
            <span className="text-[13px] font-bold text-white">GradiumOS</span>
            <span className="inline-block w-px h-[13px] bg-gold mx-1.5" />
            <span className="text-[13px] font-medium text-[#A78BFA]">Workforce</span>
          </div>
        </div>
        {user && (
          <div className="flex items-center gap-2 px-2.5 py-2 bg-white/[0.05] rounded">
            <div className="w-2 h-2 rounded-full bg-gold flex-shrink-0" />
            <div>
              <div className="text-[11px] font-semibold text-white/80">{user.employerName}</div>
              <div className="text-[9px] text-white/40">Index v1.2</div>
            </div>
          </div>
        )}
      </div>
      <nav className="flex-1 py-2">
        <div className="px-[18px] py-3.5 pb-1 text-[9px] font-semibold text-white/30 uppercase tracking-[1.2px]">Navigation</div>
        {NAV.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => clsx(
            'flex items-center gap-2.5 px-[18px] py-2 text-[12.5px] border-l-2 transition-all duration-100 select-none',
            isActive ? 'bg-accent/[0.18] border-l-accent text-white font-medium' : 'border-l-transparent text-white/50 hover:bg-white/[0.05] hover:text-white/80'
          )}>
            <span className="text-sm opacity-70">{icon}</span>{label}
          </NavLink>
        ))}
      </nav>
      <div className="px-[18px] py-3 border-t border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] rounded-full bg-accent flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-white/80 truncate">{user?.name ?? '—'}</div>
            <button onClick={logout} className="text-[10px] text-white/40 hover:text-white/70 transition-colors">Logout</button>
          </div>
          {bellSlot}
        </div>
      </div>
    </aside>
  )
}
