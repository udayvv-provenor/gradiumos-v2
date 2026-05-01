import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch, apiStream } from '../../../lib/api'
import { showToast } from '../../../components/Toast'
import type { TutorSession, TutorMessage, TutorSummary, SubtopicConcept } from '../../../types'
import clsx from 'clsx'

/* TutorTab — embedded inside the Subtopic page. Auto-starts a session
 * scoped to THIS subtopic the moment the tab is opened (no setup screen).
 * The opening message uses the hand-authored `tutorOpener` from the concept
 * payload so the conversation has context from the start. */
interface Props {
  subtopic: { code: string; clusterCode: string; name: string }
  concept:  SubtopicConcept
  onComplete?: () => void
}

export default function TutorTab({ subtopic, concept, onComplete }: Props) {
  const [session, setSession] = useState<TutorSession | null>(null)
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [summary, setSummary] = useState<TutorSummary | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  const startMut = useMutation<TutorSession, Error, void>({
    mutationFn: () => apiFetch('/api/talent/me/tutor/sessions', {
      method: 'POST',
      body: JSON.stringify({ cluster: subtopic.clusterCode, topic: subtopic.name }),
    }),
    onSuccess: s => {
      setSession(s)
      // Seed the conversation with the hand-authored opener from the Concept payload.
      // This gives the learner a meaningful first prompt instead of a generic "What
      // would you like to explore?" — the AI is set up to coach on this subtopic.
      setMessages([{ role: 'assistant', content: concept.tutorOpener }])
    },
    onError: e => showToast(e.message),
  })

  const endMut = useMutation<TutorSummary, Error, void>({
    mutationFn: () => apiFetch(`/api/talent/me/tutor/sessions/${session!.id}/end`, { method: 'POST' }),
    onSuccess: s => { setSummary(s); onComplete?.() },
    onError: e => showToast(e.message),
  })

  // Auto-start session on first mount (only once)
  useEffect(() => {
    if (!startedRef.current) { startedRef.current = true; startMut.mutate() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendMessage() {
    if (!session || !input.trim() || isStreaming) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setIsStreaming(true)
    let assistantText = ''
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    try {
      await apiStream(
        `/api/talent/me/tutor/sessions/${session.id}/turn`,
        { message: userMsg },
        chunk => {
          assistantText += chunk
          setMessages(prev => {
            const msgs = [...prev]
            msgs[msgs.length - 1] = { role: 'assistant', content: assistantText }
            return msgs
          })
        }
      )
    } catch {
      setMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: assistantText || 'Sorry, the tutor reply failed. Try again.' }
        return msgs
      })
    } finally { setIsStreaming(false) }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // Loading state (waiting for auto-started session to come back)
  if (!session && startMut.isPending) {
    return (
      <div className="bg-white border border-rule rounded-md shadow-card p-12 text-center text-slate text-sm">
        <div className="animate-pulse">Starting AI tutor session for <span className="text-navy font-semibold">{subtopic.name}</span>…</div>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="bg-white border border-rule rounded-md p-6 text-center">
        <p className="text-sm text-slate mb-3">Couldn't start the session.</p>
        <button onClick={() => startMut.mutate()} className="px-3 py-1.5 text-xs font-semibold rounded bg-accent text-white">Retry</button>
      </div>
    )
  }

  // Summary screen after End
  if (summary) {
    return (
      <div className="bg-white border border-rule rounded-md shadow-card p-6 max-w-2xl">
        <div className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-3">Session ended</div>
        <h3 className="text-base font-bold text-navy mb-4">What we covered on {subtopic.name}</h3>
        <div className="mb-5">
          <div className="text-[10px] font-bold text-accent uppercase tracking-wide mb-2">Concepts discussed</div>
          <ul className="flex flex-col gap-1.5">
            {summary.conceptsCovered.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink"><span className="text-accent font-bold flex-shrink-0">·</span>{c}</li>
            ))}
          </ul>
        </div>
        <div className="mb-5">
          <div className="text-[10px] font-bold text-navy uppercase tracking-wide mb-2">Suggested next steps</div>
          <ul className="flex flex-col gap-1.5">
            {summary.suggestedNextSteps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink"><span className="text-slate font-bold flex-shrink-0">→</span>{s}</li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => { setSession(null); setMessages([]); setSummary(null); startedRef.current = false; startMut.mutate() }}
          className="py-2 px-4 bg-accent text-white text-xs font-semibold rounded hover:bg-accent-dark transition-colors"
        >
          Start a new session →
        </button>
      </div>
    )
  }

  // Chat screen
  return (
    <div className="flex flex-col h-[calc(100vh-22rem)] max-w-3xl">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] text-slate">
          AI tutor scoped to <span className="font-semibold text-navy">{subtopic.code}</span> — {subtopic.name}
        </div>
        <button
          onClick={() => endMut.mutate()}
          disabled={endMut.isPending || isStreaming}
          className="px-3 py-1.5 text-[11px] font-semibold rounded border border-rule bg-white hover:bg-cloud transition-colors disabled:opacity-50"
        >
          {endMut.isPending ? 'Ending…' : 'End session'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-md border border-rule shadow-card p-4 flex flex-col gap-3 mb-3">
        {messages.map((m, i) => (
          <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={clsx(
              'max-w-[80%] px-4 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap',
              m.role === 'user' ? 'bg-accent text-white' : 'bg-cloud text-ink border border-rule'
            )}>
              {m.content || <span className="opacity-40 animate-pulse">▌</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          placeholder="Reply to the tutor… (Enter to send, Shift+Enter for newline)"
          className="flex-1 text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors resize-none"
          disabled={isStreaming}
        />
        <button
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          className="px-4 py-2 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-50 self-end"
        >
          Send
        </button>
      </div>
    </div>
  )
}
