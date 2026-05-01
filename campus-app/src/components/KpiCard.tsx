import clsx from 'clsx'
import type { ReactNode } from 'react'

interface Props {
  label: string
  value: ReactNode
  delta?: string
  deltaDir?: 'up' | 'down' | 'neutral'
  badge?: string
  badgeColor?: 'green' | 'amber' | 'red' | 'blue'
  onClick?: () => void
}

const badgeColors = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red:   'bg-red-100 text-red-800',
  blue:  'bg-accent-light text-accent',
}

export function KpiCard({ label, value, delta, deltaDir = 'neutral', badge, badgeColor = 'green', onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white rounded-md border border-rule shadow-card p-4',
        'transition-all duration-150',
        onClick && 'cursor-pointer hover:shadow-hover hover:-translate-y-px'
      )}
    >
      <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">{label}</div>
      <div className="text-[26px] font-bold text-navy leading-none mb-1">{value}</div>
      {delta && (
        <div className={clsx('text-[11px] font-medium',
          deltaDir === 'up' ? 'text-green-700' : deltaDir === 'down' ? 'text-red-600' : 'text-slate'
        )}>
          {deltaDir === 'up' ? '↑ ' : deltaDir === 'down' ? '↓ ' : ''}{delta}
        </div>
      )}
      {badge && (
        <div className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1.5', badgeColors[badgeColor])}>
          {badge}
        </div>
      )}
    </div>
  )
}
