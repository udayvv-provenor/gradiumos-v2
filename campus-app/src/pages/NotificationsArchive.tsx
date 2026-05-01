/**
 * BC 131 — Notifications archive page (/notifications/archive) — Campus portal
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import clsx from 'clsx'

interface Notification {
  id: string
  title: string
  body: string
  deepLink?: string | null
  readAt?: string | null
  createdAt: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function NotificationsArchive() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', true],
    queryFn: () => apiFetch<{ notifications: Notification[]; unreadCount: number }>('/api/v1/notifications?archive=true'),
    refetchInterval: 30_000,
  } as any) as { data: { notifications: Notification[]; unreadCount: number } | undefined; isLoading: boolean }

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch<{ id: string; readAt: string }>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })

  const markAllRead = useMutation({
    mutationFn: () => apiFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">Notification History</h1>
          <p className="text-sm text-slate mt-0.5">All notifications including archived ones</p>
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending} className="text-xs text-accent hover:text-accent-dark font-medium disabled:opacity-50">
              Mark all read
            </button>
          )}
          <button onClick={() => navigate(-1)} className="text-xs text-slate hover:text-ink transition-colors border border-rule rounded px-2.5 py-1.5">Back</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-rule shadow-card overflow-hidden">
        {isLoading && <div className="flex items-center justify-center h-32 text-sm text-slate">Loading…</div>}
        {!isLoading && notifications.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-slate">No notifications yet.</div>
        )}
        {notifications.map((n, i) => (
          <button
            key={n.id}
            onClick={() => { if (!n.readAt) markRead.mutate(n.id); if (n.deepLink) navigate(n.deepLink) }}
            className={clsx(
              'w-full text-left px-5 py-4 transition-colors hover:bg-cloud',
              i < notifications.length - 1 && 'border-b border-rule/60',
              !n.readAt && 'bg-accent-light/20',
            )}
          >
            <div className="flex items-start gap-3">
              <div className={clsx('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', n.readAt ? 'bg-rule' : 'bg-accent')} />
              <div className="flex-1 min-w-0">
                <div className={clsx('text-sm font-medium', n.readAt ? 'text-slate' : 'text-ink')}>{n.title}</div>
                <div className="text-xs text-slate mt-0.5 leading-relaxed">{n.body}</div>
                <div className="text-[10px] text-slate/60 mt-1">{relativeTime(n.createdAt)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
