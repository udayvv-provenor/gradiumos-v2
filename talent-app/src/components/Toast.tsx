import { useEffect, useRef, useState } from 'react'
interface Toast { id: number; message: string; type?: 'error' | 'success' }
let listeners: ((t: Toast) => void)[] = []
let nextId = 1
export function showToast(message: string, type: Toast['type'] = 'error') {
  const t = { id: nextId++, message, type }; listeners.forEach(fn => fn(t))
}
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    const h = (t: Toast) => {
      setToasts(p => [...p, t])
      timers.current.set(t.id, setTimeout(() => { setToasts(p => p.filter(x => x.id !== t.id)); timers.current.delete(t.id) }, 4000))
    }
    listeners.push(h); return () => { listeners = listeners.filter(f => f !== h) }
  }, [])
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-md text-sm font-medium shadow-modal ${t.type === 'success' ? 'bg-green-700 text-white' : 'bg-navy text-white'}`}>{t.message}</div>
      ))}
    </div>
  )
}
