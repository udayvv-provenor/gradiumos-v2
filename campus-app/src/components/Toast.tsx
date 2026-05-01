import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

interface Toast {
  id: number
  message: string
  type?: 'error' | 'success'
}

let toastListeners: ((t: Toast) => void)[] = []
let nextId = 1

export function showToast(message: string, type: Toast['type'] = 'error') {
  const t: Toast = { id: nextId++, message, type }
  toastListeners.forEach(fn => fn(t))
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const handler = (t: Toast) => {
      setToasts(prev => [...prev, t])
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id))
        timers.current.delete(t.id)
      }, 4000)
      timers.current.set(t.id, timer)
    }
    toastListeners.push(handler)
    return () => { toastListeners = toastListeners.filter(f => f !== handler) }
  }, [])

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto px-4 py-3 rounded-md text-sm font-medium shadow-modal',
            'animate-[fadeSlideIn_0.2s_ease]',
            t.type === 'success'
              ? 'bg-green-700 text-white'
              : 'bg-navy text-white'
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
