import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch, apiStream } from '../lib/api'
import { showToast } from '../components/Toast'
import type { TutorSession, TutorMessage, TutorSummary } from '../types'
import clsx from 'clsx'

// v3.1.4 — fixed to match locked GradiumOS taxonomy. The previous list was a
// regression (used early-2025 working names). The IP validator only catches
// backend drift; this UI list slipped through.
const CLUSTERS = [
  { id: 'C1', name: 'Core Technical Foundations' },
  { id: 'C2', name: 'Applied Problem Solving' },
  { id: 'C3', name: 'Engineering Execution' },
  { id: 'C4', name: 'System & Product Thinking' },
  { id: 'C5', name: 'Communication & Collaboration' },
  { id: 'C6', name: 'Domain Specialisation' },
  { id: 'C7', name: 'Ownership & Judgment' },
  { id: 'C8', name: 'Learning Agility' },
]

// v3.1.5 — Tutor reframed as a PARTNER, not a teacher. Two new behaviours:
//  - "Save for end-of-session" toggle on each turn — queues the doubt instead
//    of answering live. At session end, AI batches all saved doubts into ONE
//    structured digest. Better for flow-state work.
//  - Opener now asks what work the learner is currently doing — grounds the
//    conversation in real artifacts instead of academic topic exploration.
type SavedDoubt = { question: string; askedAt: number }

export default function Tutor() {
  const [session, setSession] = useState<TutorSession | null>(null)
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [summary, setSummary] = useState<TutorSummary | null>(null)
  const [selectedCluster, setSelectedCluster] = useState(CLUSTERS[0].id)
  const [topic, setTopic] = useState('')
  const [saveMode, setSaveMode] = useState(false)         // when true, next send is queued not answered
  const [savedDoubts, setSavedDoubts] = useState<SavedDoubt[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const startMut = useMutation<TutorSession, Error, { cluster: string; topic: string }>({
    mutationFn: data => apiFetch('/api/talent/me/tutor/sessions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: s => {
      setSession(s)
      // v3.1.5 — partner opener. NOT "what would you like to explore" (teacher
      // framing). Instead: ground the conversation in current real work.
      setMessages([{ role: 'assistant', content: `I'm here as a partner, not a lecturer. Tell me what you're working on right now in **${s.cluster} — ${s.topic}** — a PR, a bug, a Slack you need to write, a design call. We'll work through it together. If something doesn't need an answer right now, hit "Save for end" and I'll batch it into a digest at the end.` }])
    },
    onError: e => showToast(e.message),
  })

  const endMut = useMutation<TutorSummary, Error, void>({
    mutationFn: () => apiFetch(`/api/talent/me/tutor/sessions/${session!.id}/end`, { method: 'POST' }),
    onSuccess: s => setSummary(s),
    onError: e => showToast(e.message),
  })

  async function sendMessage() {
    if (!session || !input.trim() || isStreaming) return
    const userMsg = input.trim()
    setInput('')

    // v3.1.5 — save-mode: queue the doubt, send a one-line ack, do NOT call AI
    if (saveMode) {
      setSavedDoubts(prev => [...prev, { question: userMsg, askedAt: Date.now() }])
      setMessages(prev => [
        ...prev,
        { role: 'user', content: userMsg },
        { role: 'assistant', content: `_Saved (#${savedDoubts.length + 1}). I'll come back to this in the end-of-session digest._` },
      ])
      setSaveMode(false)
      return
    }

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
        msgs[msgs.length - 1] = { role: 'assistant', content: assistantText || 'Sorry, something went wrong. Please try again.' }
        return msgs
      })
    } finally {
      setIsStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  // Setup screen
  if (!session) {
    return (
      <div className="max-w-xl">
        <div className="mb-5">
          <h1 className="text-[19px] font-bold text-navy">AI Tutor</h1>
          <p className="text-xs text-slate mt-0.5">Get personalised coaching on any GradiumOS cluster</p>
        </div>
        <div className="mb-5 px-4 py-3 bg-accent-light/40 border-l-[3px] border-accent rounded">
          <div className="text-xs text-ink">
            <strong className="text-navy">Tip:</strong> opening a tutor session from inside a sub-topic in the <strong>Learn</strong> tab gives the AI specific context (concept primer + your past attempts on this topic) for sharper coaching.
          </div>
        </div>
        <div className="bg-white rounded-md border border-rule shadow-card p-6">
          <h2 className="text-sm font-bold text-navy mb-4">Start a tutor session</h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-navy mb-2">Select Cluster</label>
              <div className="grid grid-cols-2 gap-2">
                {CLUSTERS.map(c => (
                  <button key={c.id} type="button" onClick={() => setSelectedCluster(c.id)}
                    className={clsx('text-left px-3 py-2 rounded-md border text-xs transition-all', selectedCluster === c.id ? 'border-accent bg-accent-light text-navy font-medium' : 'border-rule bg-white text-slate hover:border-accent/40')}>
                    <div className="font-bold text-[10px] mb-0.5">{c.id}</div>
                    <div>{c.name}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy mb-1.5">Sub-topic (optional)</label>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. REST API design, microservices, debugging strategies…"
                className="w-full text-sm px-3 py-2 border border-rule rounded focus:outline-none focus:border-accent transition-colors" />
            </div>
            <button onClick={() => startMut.mutate({ cluster: selectedCluster, topic: topic || CLUSTERS.find(c => c.id === selectedCluster)!.name })}
              disabled={startMut.isPending}
              className="py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-60">
              {startMut.isPending ? 'Starting session…' : 'Start tutor session →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Summary screen
  if (summary) {
    return (
      <div className="max-w-xl">
        <div className="mb-5">
          <h1 className="text-[19px] font-bold text-navy">Session Summary</h1>
          <p className="text-xs text-slate mt-0.5">{session.cluster} · {session.topic}</p>
        </div>
        <div className="bg-white rounded-md border border-rule shadow-card p-6 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2">Concepts Covered</div>
            <ul className="flex flex-col gap-1.5">
              {summary.conceptsCovered.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink"><span className="text-accent font-bold flex-shrink-0">·</span>{c}</li>
              ))}
            </ul>
          </div>
          <div className="h-px bg-rule" />
          <div>
            <div className="text-xs font-bold text-navy uppercase tracking-wide mb-2">Suggested Next Steps</div>
            <ul className="flex flex-col gap-1.5">
              {summary.suggestedNextSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink"><span className="text-slate font-bold flex-shrink-0">→</span>{s}</li>
              ))}
            </ul>
          </div>
          {/* v3.1.5 — saved-doubts digest. Each saved doubt becomes a queued item
           * the learner can re-ask now, or open as a fresh tutor session later. */}
          {savedDoubts.length > 0 && (
            <>
              <div className="h-px bg-rule" />
              <div>
                <div className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2 flex items-center gap-2">
                  Saved Doubts
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{savedDoubts.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {savedDoubts.map((d, i) => (
                    <div key={i} className="bg-amber-50 border border-amber-200 rounded p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Doubt #{i + 1}</div>
                      <div className="text-[12.5px] text-ink leading-relaxed">{d.question}</div>
                      <div className="text-[10px] text-slate mt-1.5 italic">Open a fresh tutor session and paste this in to dive deeper.</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <button onClick={() => { setSession(null); setMessages([]); setSummary(null); setTopic(''); setSavedDoubts([]) }}
            className="mt-2 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors">
            Start new session →
          </button>
        </div>
      </div>
    )
  }

  // Chat screen
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-2xl">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-[15px] font-bold text-navy">{session.cluster} · {session.topic}</h1>
          <p className="text-xs text-slate">AI Tutor Session</p>
        </div>
        <button onClick={() => endMut.mutate()} disabled={endMut.isPending || isStreaming}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-rule bg-white hover:bg-cloud transition-colors disabled:opacity-50">
          {endMut.isPending ? 'Ending…' : 'End session'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-white rounded-md border border-rule shadow-card p-4 flex flex-col gap-3 mb-3">
        {messages.map((m, i) => (
          <div key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={clsx('max-w-[80%] px-4 py-2.5 rounded-lg text-sm leading-relaxed',
              m.role === 'user' ? 'bg-accent text-white' : 'bg-cloud text-ink border border-rule'
            )}>
              {m.content || <span className="opacity-40 animate-pulse">▌</span>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input — v3.1.5 partner-mode controls */}
      <div className="flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center justify-between text-[10px] text-slate">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={saveMode}
              onChange={(e) => setSaveMode(e.target.checked)}
              className="rounded"
            />
            <span className={clsx('font-semibold', saveMode ? 'text-amber-700' : 'text-slate')}>
              Save next message for end-of-session digest (don't interrupt my flow)
            </span>
          </label>
          {savedDoubts.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
              {savedDoubts.length} saved
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={saveMode ? 'Type a doubt to save for later…' : 'Ask the partner… (Enter to send, Shift+Enter newline)'}
            className={clsx(
              'flex-1 text-sm px-3 py-2 border rounded focus:outline-none transition-colors resize-none',
              saveMode ? 'border-amber-400 bg-amber-50/30 focus:border-amber-500' : 'border-rule focus:border-accent',
            )}
            disabled={isStreaming}
          />
          <button onClick={sendMessage} disabled={isStreaming || !input.trim()}
            className={clsx(
              'px-4 py-2 text-white text-sm font-semibold rounded transition-colors disabled:opacity-50 self-end',
              saveMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-accent hover:bg-accent-dark',
            )}>
            {saveMode ? 'Save →' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
