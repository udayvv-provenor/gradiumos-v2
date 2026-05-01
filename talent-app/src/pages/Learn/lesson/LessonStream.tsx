import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '../../../lib/api'
import { showToast } from '../../../components/Toast'
import type { LessonCard, LessonCardEntry, SubtopicConcept } from '../../../types'
import LessonCardView from './LessonCardView'

/* ── LessonStream ────────────────────────────────────────────────────
 * The unique tutor interface. NOT a chatbot. NOT chat bubbles. NOT
 * a markdown renderer with code blocks and Mermaid.
 *
 * Instead:
 *   - The lesson is a vertical STREAM of typed cards (Explanation, Question,
 *     Example, Reflection, Check, Detour). Each card has its own custom
 *     layout from LessonCardView.
 *   - Interaction happens INSIDE the active card (form fields embedded
 *     in the card), not via a single bottom input box.
 *   - The "Next" button reveals when the active card is complete; the
 *     server then generates the next card based on the full history.
 *   - A left-rail timeline shows all cards as colored dots — click any
 *     dot to jump back. Cards stay in place; new cards stack below.
 *
 * Visual language:
 *   - Cards have a left-border accent strip whose color encodes the kind.
 *   - No "user said / AI said" labels — learner content is in form fields,
 *     visually distinct from the AI's prose, but never in a "bubble".
 *   - Subtle slide-in animation on each new card (transform + opacity).
 *
 * Why this matters: per the legal-differentiation requirement, this
 * intentionally avoids the de-facto AI-tutor UI patterns (chat bubbles,
 * triple-backtick code, Mermaid diagrams, single bottom input). */

interface Props {
  subtopic: { code: string; clusterCode: string; name: string }
  concept: SubtopicConcept
  onLessonComplete?: () => void
}

export default function LessonStream({ subtopic }: Props) {
  const [entries, setEntries] = useState<LessonCardEntry[]>([])
  const [started, setStarted] = useState(false)
  const streamRef = useRef<HTMLDivElement>(null)

  const nextCardMut = useMutation<LessonCard, Error, { learnerLastResponse?: string }>({
    mutationFn: ({ learnerLastResponse }) => apiFetch(`/api/talent/me/lesson/${subtopic.code}/next-card`, {
      method: 'POST',
      body: JSON.stringify({
        learnerLastResponse,
        cardHistory: entries.map(e => {
          // v3.1 — flow correctness back for check cards so the server can
          // enforce the failed-check → detour rule. For non-check cards
          // wasCorrect is undefined (server treats absence as "not applicable").
          let wasCorrect: boolean | undefined
          if (e.card.kind === 'check' && e.pickedOptionId && e.card.check) {
            wasCorrect = e.pickedOptionId === e.card.check.correctId
          }
          return {
            kind:         e.card.kind,
            title:        e.card.title,
            learnerInput: e.learnerInput ?? e.pickedOptionId,
            ...(wasCorrect !== undefined ? { wasCorrect } : {}),
          }
        }),
      }),
    }),
    onSuccess: (card) => {
      setEntries(prev => [...prev, { card }])
    },
    onError: e => showToast(e.message),
  })

  // v3.1.1 — explicit Begin button instead of auto-fetch on mount.
  // Reasons:
  //   1) React 18 StrictMode double-invokes useEffect, which races with
  //      TanStack useMutation's pending state and stalls the loader.
  //   2) UX-wise: the learner gets a moment to read the page header before
  //      the lesson starts streaming.
  function beginLesson() { setStarted(true); nextCardMut.mutate({}) }

  // Auto-scroll to newest card
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries.length])

  function markComplete(idx: number, learnerInput?: string, pickedOptionId?: string) {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, learnerInput, pickedOptionId, isComplete: true } : e))
  }

  function continueLesson(lastInput?: string) {
    nextCardMut.mutate({ learnerLastResponse: lastInput })
  }

  const lastIdx = entries.length - 1
  const lastEntry = entries[lastIdx]
  const showNextButton = lastEntry && (
    !lastEntry.card.awaitsLearner || lastEntry.isComplete
  ) && !nextCardMut.isPending

  return (
    <div className="flex gap-5 h-[calc(100vh-22rem)]">
      {/* Left rail — lesson progress timeline (NOT a chat history) */}
      <aside className="flex-shrink-0 w-12 bg-white border border-rule rounded-md py-3 px-1 flex flex-col items-center gap-1 overflow-y-auto">
        <div className="text-[8px] font-semibold text-slate uppercase tracking-wider mb-2">Lesson</div>
        {entries.map((e, i) => (
          <button
            key={i}
            onClick={() => {
              const node = document.getElementById(`lesson-card-${i}`)
              node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${kindDot(e.card.kind)} ${e.isComplete ? 'opacity-60' : ''}`}
            title={`${e.card.kind} — ${e.card.title}`}
          >
            {i + 1}
          </button>
        ))}
        {nextCardMut.isPending && (
          <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin mt-1" />
        )}
      </aside>

      {/* Main stream */}
      <div ref={streamRef} className="flex-1 overflow-y-auto pr-2">
        {/* v3.1.1 — explicit start, replaces the auto-mount race */}
        {!started && (
          <div className="text-center py-16 px-6">
            <div className="text-3xl mb-3 opacity-30">◐</div>
            <h3 className="text-base font-bold text-navy mb-1">Ready to begin?</h3>
            <p className="text-xs text-slate max-w-md mx-auto mb-5 leading-relaxed">
              The lesson streams card-by-card. Each card is a piece of the lesson —
              an explanation, an example, a quick check, or a reflective prompt — and
              the next one is shaped by how you respond. If you get stuck, type "I'm not sure"
              and the tutor will detour to a different angle.
            </p>
            <button
              onClick={beginLesson}
              className="px-5 py-2.5 bg-accent text-white text-sm font-semibold rounded hover:bg-accent-dark transition-colors"
            >
              Begin lesson on {subtopic.name} →
            </button>
          </div>
        )}

        {started && entries.length === 0 && nextCardMut.isPending && (
          <div className="text-center text-slate text-sm py-12">
            <div className="inline-block w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mb-3" />
            <div>Preparing your lesson on <span className="text-navy font-semibold">{subtopic.name}</span>…</div>
          </div>
        )}

        <div className="flex flex-col gap-4 pb-6">
          {entries.map((entry, i) => (
            <div key={i} id={`lesson-card-${i}`}>
              <LessonCardView
                entry={entry}
                isActive={i === lastIdx}
                onLearnerSubmit={(input, optId) => markComplete(i, input, optId)}
              />
            </div>
          ))}
        </div>

        {/* Next button — appears at the bottom when ready to advance */}
        {showNextButton && (
          <div className="sticky bottom-0 bg-gradient-to-t from-cloud via-cloud/95 to-transparent pt-6 pb-3 mt-2">
            <button
              onClick={() => continueLesson(lastEntry?.learnerInput ?? lastEntry?.pickedOptionId)}
              className="w-full py-3 px-5 rounded-md bg-navy text-white text-sm font-semibold hover:bg-navy/90 transition-all flex items-center justify-center gap-2 shadow-card"
            >
              Continue the lesson
              <span className="text-base">↓</span>
            </button>
          </div>
        )}

        {nextCardMut.isPending && entries.length > 0 && (
          <div className="text-center text-slate text-xs py-4">
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse mr-1" />
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse mr-1" style={{ animationDelay: '150ms' }} />
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" style={{ animationDelay: '300ms' }} />
            <span className="ml-2">Composing the next card</span>
          </div>
        )}
      </div>
    </div>
  )
}

function kindDot(kind: string): string {
  switch (kind) {
    case 'explanation': return 'bg-accent text-white'
    case 'question':    return 'bg-amber-500 text-white'
    case 'example':     return 'bg-violet-500 text-white'
    case 'reflection':  return 'bg-pink-500 text-white'
    case 'check':       return 'bg-emerald-600 text-white'
    case 'detour':      return 'bg-slate text-white'
    default:            return 'bg-slate/40 text-white'
  }
}
