/**
 * BC 128-133 — Notification drawer (Phase D) — Campus portal
 *
 * Bell icon with unread badge + slide-in drawer.
 * Polls GET /api/v1/notifications every 30s via TanStack Query.
 */
import { useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import clsx from 'clsx'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  type: string
  title: string
  body: string
  deepLink?: string | null
  readAt?: string | null
  createdAt: string
}

interface NotificationsResponse {
  notifications: Notification[]
  unreadCount: number
}

// ─── Relative time helper ────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useNotifications(archive = false) {
  return useQuery({
    queryKey: ['notifications', archive],
    queryFn: () => apiFetch<NotificationsResponse>(
      `/api/v1/notifications${archive ? '?archive=true' : ''}`,
    ),
    refetchInterval: 30_000,
    staleTime: 20_000,
  } as any) as { data: NotificationsResponse | undefined; isLoading: boolean }
}

// ─── Bell button ─────────────────────────────────────────────────────────────

interface BellButtonProps {
  onClick: () => void
}

export function BellButton({ onClick }: BellButtonProps) {
  const { data } = useNotifications()
  const count = data?.unreadCount ?? 0

  return (
    <button
      onClick={onClick}
      aria-label="Notifications"
      className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white"
    >
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

// ─── Main Drawer ─────────────────────────────────────────────────────────────

interface NotificationDrawerProps {
  open: boolean
  onClose: () => void
}

export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const drawerRef = useRef<HTMLDivElement>(null)
  const { data, isLoading } = useNotifications()

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; readAt: string }>(`/api/v1/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })

  const markAllRead = useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>('/api/v1/notifications/read-all', { method: 'PATCH' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }) },
  })

  function handleNotificationClick(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id)
    if (n.deepLink) { navigate(n.deepLink); onClose() }
  }

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />}
      <div
        ref={drawerRef}
        className={clsx(
          'fixed top-0 right-0 h-full w-[360px] bg-white shadow-modal z-50 flex flex-col transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-rule">
          <div>
            <h2 className="text-sm font-semibold text-ink">Notifications</h2>
            {unreadCount > 0 && <div className="text-xs text-slate mt-0.5">{unreadCount} unread</div>}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending} className="text-xs text-accent hover:text-accent-dark font-medium disabled:opacity-50">
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-slate hover:text-ink transition-colors" aria-label="Close">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && <div className="flex items-center justify-center h-32 text-sm text-slate">Loading…</div>}
          {!isLoading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-sm text-slate gap-2">
              <svg className="w-8 h-8 text-rule" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span>No notifications yet</span>
            </div>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              className={clsx(
                'w-full text-left px-5 py-3.5 border-b border-rule/60 transition-colors hover:bg-cloud',
                !n.readAt && 'bg-accent-light/30',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={clsx('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', n.readAt ? 'bg-rule' : 'bg-accent')} />
                <div className="flex-1 min-w-0">
                  <div className={clsx('text-xs font-semibold truncate', n.readAt ? 'text-slate' : 'text-ink')}>{n.title}</div>
                  <div className="text-xs text-slate mt-0.5 leading-relaxed line-clamp-2">{n.body}</div>
                  <div className="text-[10px] text-slate/60 mt-1">{relativeTime(n.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-rule flex items-center justify-between">
          <button onClick={() => { navigate('/notifications/archive'); onClose() }} className="text-xs text-slate hover:text-ink transition-colors">View archive</button>
          <button onClick={() => { navigate('/settings/notifications'); onClose() }} className="text-xs text-slate hover:text-ink transition-colors">Settings</button>
        </div>
      </div>
    </>
  )
}
