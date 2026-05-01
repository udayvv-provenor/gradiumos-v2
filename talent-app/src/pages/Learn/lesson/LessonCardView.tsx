import { useState } from 'react'
import type { LessonCardEntry } from '../../../types'
import clsx from 'clsx'

/* LessonCardView — renders ONE typed card. Each kind has its own custom
 * layout. Deliberately distinct from chat-bubble UIs:
 *   - No "AI vs you" alignment. The AI's content sits in editorial
 *     prose blocks; the learner's content sits in form fields embedded
 *     IN the card.
 *   - No markdown renderer. We do basic line-break and bold parsing
 *     inline so we never need a third-party markdown library here.
 *   - No code blocks. Code-like content lives in `annotations` as
 *     small labelled inline cues — visually distinct from the body.
 *   - No Mermaid. Structural relationships (when needed) are described
 *     in prose or via simple positioned divs in the example slot.
 */

interface Props {
  entry: LessonCardEntry
  isActive: boolean
  onLearnerSubmit: (textInput?: string, pickedOptionId?: string) => void
}

const KIND_META: Record<string, { label: string; accent: string; bg: string; icon: string }> = {
  explanation: { label: 'Concept',   accent: 'border-l-accent',     bg: 'bg-white',           icon: '◐' },
  question:    { label: 'Question',  accent: 'border-l-amber-500',  bg: 'bg-amber-50/40',     icon: '?' },
  example:     { label: 'Example',   accent: 'border-l-violet-500', bg: 'bg-violet-50/30',    icon: '★' },
  reflection:  { label: 'Reflection',accent: 'border-l-pink-500',   bg: 'bg-pink-50/30',      icon: '◊' },
  check:       { label: 'Check',     accent: 'border-l-emerald-600',bg: 'bg-emerald-50/30',   icon: '✓' },
  detour:      { label: 'Detour',    accent: 'border-l-slate',      bg: 'bg-slate-50/40',     icon: '↗' },
}

export default function LessonCardView({ entry, isActive, onLearnerSubmit }: Props) {
  const meta = KIND_META[entry.card.kind] ?? KIND_META.explanation
  return (
    <article
      className={clsx(
        'border border-rule rounded-md shadow-card overflow-hidden transition-all',
        meta.accent, 'border-l-[4px]', meta.bg,
        isActive ? 'ring-1 ring-accent/20' : '',
        // Detour gets indented to visually mark it as a side path
        entry.card.kind === 'detour' ? 'ml-8 max-w-[90%]' : '',
      )}
    >
      {/* Header strip */}
      <div className="px-5 pt-3.5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none w-6 h-6 inline-flex items-center justify-center rounded-full bg-white border border-rule text-navy">{meta.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate">{meta.label}</span>
        </div>
        {entry.card.conceptTags && entry.card.conceptTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {entry.card.conceptTags.map((t, i) => (
              <span key={i} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white border border-rule text-slate">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="px-5 text-base font-bold text-navy mb-2 leading-snug">{entry.card.title}</h3>

      {/* Body — editorial prose, NOT markdown rendered */}
      {entry.card.body && (
        <div className="px-5 pb-3 text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
          <ProseBody text={entry.card.body} />
        </div>
      )}

      {/* Kind-specific slots */}
      {entry.card.example && <ExampleSlot example={entry.card.example} />}
      {entry.card.annotations && entry.card.annotations.length > 0 && <AnnotationsSlot annotations={entry.card.annotations} />}
      {entry.card.kind === 'check' && entry.card.check && (
        <CheckSlot check={entry.card.check} entry={entry} onPick={(id) => onLearnerSubmit(undefined, id)} />
      )}
      {(entry.card.kind === 'question' || entry.card.kind === 'reflection') && entry.card.question && (
        <FreeTextSlot question={entry.card.question} entry={entry} onSubmit={(t) => onLearnerSubmit(t)} />
      )}

      {/* Bottom margin */}
      <div className="px-5 pb-4" />
    </article>
  )
}

/* ── Body renderer ─────────────────────────────────────────────────
 * Minimal: only line breaks + **bold** + numbered/bulleted list lines.
 * Deliberately NOT a markdown library — the lesson text comes pre-shaped
 * by the AI into clean prose. */
function ProseBody({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />
        // Numbered list line
        const numMatch = line.match(/^(\d+\.)\s+(.+)$/)
        if (numMatch) {
          return (
            <div key={i} className="flex gap-2 my-1">
              <span className="text-accent font-bold flex-shrink-0">{numMatch[1]}</span>
              <span><Inline text={numMatch[2]} /></span>
            </div>
          )
        }
        // Bullet line
        const bulMatch = line.match(/^[-•]\s+(.+)$/)
        if (bulMatch) {
          return (
            <div key={i} className="flex gap-2 my-1">
              <span className="text-accent flex-shrink-0">·</span>
              <span><Inline text={bulMatch[1]} /></span>
            </div>
          )
        }
        return <div key={i} className="my-1"><Inline text={line} /></div>
      })}
    </>
  )
}

/* Inline bold parser — splits on **bold** spans. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i} className="font-semibold text-navy">{p.slice(2, -2)}</strong>
        }
        return <span key={i}>{p}</span>
      })}
    </>
  )
}

/* ── Example slot ─────────────────────────────────────────────────
 * Custom before/after comparison panel. NOT a code block — these are
 * editorial cards with mono font and a left strip. */
function ExampleSlot({ example }: { example: { before?: string; after?: string; callout?: string } }) {
  return (
    <div className="px-5 pb-3 grid grid-cols-2 gap-3">
      {example.before && (
        <div className="bg-white border border-rule rounded p-3.5 relative">
          <div className="absolute top-0 left-0 bottom-0 w-1 bg-red-300 rounded-l" />
          <div className="text-[9px] font-bold text-red-600 uppercase tracking-wider mb-1.5">Before</div>
          <div className="text-[12px] text-ink leading-relaxed font-mono whitespace-pre-wrap">{example.before}</div>
        </div>
      )}
      {example.after && (
        <div className="bg-white border border-rule rounded p-3.5 relative">
          <div className="absolute top-0 left-0 bottom-0 w-1 bg-green-500 rounded-l" />
          <div className="text-[9px] font-bold text-green-700 uppercase tracking-wider mb-1.5">After</div>
          <div className="text-[12px] text-ink leading-relaxed font-mono whitespace-pre-wrap">{example.after}</div>
        </div>
      )}
      {example.callout && (
        <div className="col-span-2 px-4 py-2.5 bg-navy rounded text-white text-xs font-medium leading-relaxed">
          <span className="text-gold mr-2">▸</span>{example.callout}
        </div>
      )}
    </div>
  )
}

/* ── Annotations slot ─────────────────────────────────────────────
 * Inline labelled cues — replaces what would otherwise be a code block. */
function AnnotationsSlot({ annotations }: { annotations: { label: string; text: string }[] }) {
  return (
    <div className="px-5 pb-3 flex flex-col gap-1.5">
      {annotations.map((a, i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-2 bg-white border border-rule rounded">
          <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-wider flex-shrink-0 pt-0.5 min-w-[80px]">{a.label}</span>
          <span className="text-[12px] text-ink leading-relaxed">{a.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Check slot — embedded MCQ with reveal-on-click ─────────────── */
function CheckSlot({ check, entry, onPick }: {
  check: { options: { id: string; text: string }[]; correctId: string; explanation: string }
  entry: LessonCardEntry
  onPick: (id: string) => void
}) {
  const picked = entry.pickedOptionId
  const isCorrect = picked === check.correctId

  return (
    <div className="px-5 pb-3">
      <div className="flex flex-col gap-1.5">
        {check.options.map(opt => {
          const isPicked  = picked === opt.id
          const isCorrectOpt = opt.id === check.correctId
          return (
            <button
              key={opt.id}
              onClick={() => !picked && onPick(opt.id)}
              disabled={!!picked}
              className={clsx(
                'text-left px-4 py-2.5 rounded border-2 text-[12.5px] transition-all',
                !picked && 'border-rule bg-white hover:border-accent/50 cursor-pointer',
                picked && isCorrectOpt && 'border-green-500 bg-green-50 text-green-900 font-medium',
                picked && !isCorrectOpt && isPicked && 'border-red-400 bg-red-50 text-red-800',
                picked && !isCorrectOpt && !isPicked && 'border-rule bg-white opacity-50',
              )}
            >
              <span className="font-mono font-bold text-[10px] mr-2">{opt.id.toUpperCase()}.</span>
              {opt.text}
              {picked && isCorrectOpt && <span className="ml-2 text-[10px] font-bold text-green-700">✓ Correct</span>}
              {picked && !isCorrectOpt && isPicked && <span className="ml-2 text-[10px] font-bold text-red-600">✗ Your pick</span>}
            </button>
          )
        })}
      </div>

      {picked && (
        <div className={clsx(
          'mt-3 px-4 py-2.5 rounded border-l-[3px] text-[12px] leading-relaxed',
          isCorrect ? 'bg-green-50 border-l-green-500 text-green-900' : 'bg-amber-50 border-l-amber-500 text-amber-900',
        )}>
          <div className="text-[9px] font-bold uppercase tracking-wider mb-1">{isCorrect ? 'Why this is right' : 'Why the right answer is right'}</div>
          {check.explanation}
        </div>
      )}
    </div>
  )
}

/* ── Free-text slot — embedded textarea, submits to mark card complete ── */
function FreeTextSlot({ question, entry, onSubmit }: {
  question: { prompt: string; placeholder?: string }
  entry: LessonCardEntry
  onSubmit: (text: string) => void
}) {
  const [text, setText] = useState(entry.learnerInput ?? '')
  const submitted = !!entry.learnerInput

  return (
    <div className="px-5 pb-3">
      <div className="text-[12.5px] text-ink mb-2 leading-relaxed font-medium">{question.prompt}</div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={4}
        disabled={submitted}
        placeholder={question.placeholder ?? 'Type your answer here…'}
        className={clsx(
          'w-full text-[12.5px] px-3 py-2 border border-rule rounded resize-y leading-relaxed',
          submitted ? 'bg-cloud text-slate cursor-not-allowed' : 'bg-white text-ink focus:outline-none focus:border-accent transition-colors',
        )}
      />
      {!submitted && (
        <button
          onClick={() => text.trim() && onSubmit(text.trim())}
          disabled={!text.trim()}
          className="mt-2 px-4 py-1.5 bg-accent text-white text-[11px] font-semibold rounded hover:bg-accent-dark transition-colors disabled:opacity-50"
        >
          Submit answer
        </button>
      )}
      {submitted && (
        <div className="mt-2 text-[10px] text-slate italic">Submitted — your answer is feeding into the next card.</div>
      )}
    </div>
  )
}
