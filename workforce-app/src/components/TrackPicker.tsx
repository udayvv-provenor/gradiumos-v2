import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { showToast } from './Toast'

/**
 * v3.1.2 — TrackPicker.
 *
 * Replaces the hardcoded 8-track dropdown with a typeahead that searches the
 * platform-wide career-track catalogue (cross-portal, dynamic). If the user
 * types a name that doesn't exist, we offer "+ Create '{name}'" — POST to
 * /api/career-tracks creates it (AI maps name → cluster vocabulary) and
 * returns the new track ID, which we set as the picked value.
 *
 * The cluster TAXONOMY (C1..C8) and weight semantics are LOCKED IP. The track
 * NAME is open. This component bridges those: free user input → IP mapping.
 */
interface TrackOption { id: string; code: string; name: string }

export function TrackPicker({
  value,
  onChange,
  placeholder = 'Search or type a new career track…',
  errorMsg,
}: {
  value: string                                    // selected track id
  onChange: (id: string, name: string) => void    // bubble id + display name
  placeholder?: string
  errorMsg?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TrackOption[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pickedName, setPickedName] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Hydrate the display name from a pre-set value (e.g. ?track= deep-link)
  useEffect(() => {
    if (value && !pickedName) {
      apiFetch<TrackOption[]>(`/api/career-tracks/search?q=`).then(rs => {
        const m = rs.find(r => r.id === value)
        if (m) { setPickedName(m.name); setQuery(m.name) }
      }).catch(() => null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Click-outside closes the dropdown
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const rs = await apiFetch<TrackOption[]>(`/api/career-tracks/search?q=${encodeURIComponent(query)}`)
        setResults(rs)
      } catch (e) {
        // silent — typeahead shouldn't toast every keystroke failure
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const createMut = useMutation<{ track: TrackOption; created: boolean }, Error, string>({
    mutationFn: name => apiFetch('/api/career-tracks', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: ({ track, created }) => {
      onChange(track.id, track.name)
      setPickedName(track.name)
      setQuery(track.name)
      setOpen(false)
      showToast(created
        ? `Created new career track "${track.name}" — AI mapped it to the GradiumOS cluster vocabulary`
        : `Picked existing track "${track.name}"`,
        'success'
      )
    },
    onError: e => showToast(e.message),
  })

  const exact = results.find(r => r.name.toLowerCase() === query.trim().toLowerCase())
  const showCreate = query.trim().length >= 2 && !exact && !loading

  return (
    <div className="relative" ref={wrapRef}>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors"
      />
      {pickedName && pickedName === query && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-green-700">✓ picked</div>
      )}
      {errorMsg && <p className="text-xs text-red-600 mt-1">{errorMsg}</p>}

      {open && (query.length > 0 || results.length > 0) && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-rule rounded-md shadow-card max-h-64 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-slate">Searching catalogue…</div>}
          {!loading && results.length === 0 && query.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate">Start typing to search the platform catalogue, or type a new track name to create one.</div>
          )}
          {!loading && results.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange(r.id, r.name); setPickedName(r.name); setQuery(r.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-cloud transition-colors flex items-center justify-between"
            >
              <span><strong className="text-navy">{r.name}</strong> <span className="text-[10px] text-slate font-mono ml-1">{r.code}</span></span>
              {r.id === value && <span className="text-[10px] text-green-700 font-bold">✓</span>}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              disabled={createMut.isPending}
              onClick={() => createMut.mutate(query.trim())}
              className="w-full text-left px-3 py-2 text-sm border-t border-rule bg-accent/5 hover:bg-accent/10 transition-colors text-accent font-semibold disabled:opacity-60"
            >
              {createMut.isPending
                ? 'Creating + mapping to clusters…'
                : <>+ Create "<span className="font-bold">{query.trim()}</span>" as a new career track</>}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
