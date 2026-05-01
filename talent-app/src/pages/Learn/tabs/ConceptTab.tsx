import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SubtopicConcept } from '../../../types'
import MermaidDiagram from './MermaidDiagram'

/* Concept tab — renders the hand-authored markdown primer for the subtopic.
 * For unauthored subtopics, shows the stub content with a subtle banner.
 *
 * Mermaid diagrams from the backend are rendered live via the mermaid runtime
 * (see MermaidDiagram). If a diagram fails to parse we fall back to the raw
 * source so the lesson never breaks. */
export default function ConceptTab({ concept }: { concept: SubtopicConcept }) {
  return (
    <div className="grid grid-cols-12 gap-5">
      {/* v3.1.5 — provenance pill: honest about whether this primer is hand-authored
       * by an SME or AI-generated on demand. Sits at the top of the col-span-8 block. */}
      <div className="col-span-12 -mb-2">
        {concept.authored ? (
          <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-green-100 text-green-800">SME-authored primer</span>
        ) : (
          <span className="inline-block text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-800">AI-generated primer · grounded in the locked GradiumOS taxonomy</span>
        )}
      </div>
      {/* Main markdown column */}
      <article className="col-span-8 bg-white border border-rule rounded-md shadow-card p-7 prose prose-sm max-w-none
        prose-headings:text-navy prose-headings:font-bold prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3
        prose-h3:text-base prose-h3:mt-5 prose-h3:mb-2
        prose-p:text-ink prose-p:leading-relaxed
        prose-strong:text-navy prose-strong:font-semibold
        prose-code:text-accent prose-code:bg-cloud prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-navy prose-pre:text-white prose-pre:text-[12px] prose-pre:rounded prose-pre:p-4
        prose-blockquote:border-l-accent prose-blockquote:bg-accent-light/40 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:not-italic prose-blockquote:text-ink
        prose-table:border prose-table:border-rule prose-th:bg-cloud prose-th:text-navy prose-th:font-semibold prose-th:text-xs prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-rule prose-td:text-xs
        prose-li:text-ink prose-li:my-1
        prose-hr:border-rule prose-hr:my-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.markdown}</ReactMarkdown>
      </article>

      {/* Side rail — meta + diagrams */}
      <aside className="col-span-4 flex flex-col gap-4">
        {/* Read-time meta */}
        <div className="bg-white border border-rule rounded-md p-4">
          <div className="text-[9px] font-semibold text-slate uppercase tracking-wide mb-2">Reading time</div>
          <div className="text-base font-bold text-navy">~{concept.estimatedReadMinutes} min</div>
          {/* v3.1.1 — drop the "Session 3" dev tell. The Lesson + Tutor surfaces
              are the primary teaching path for non-authored subtopics; the
              concept primer here is the orientation page, not the only path. */}
          {!concept.authored && (
            <div className="mt-3 px-3 py-2 bg-accent/5 border border-accent/20 rounded text-[11px] text-ink leading-relaxed">
              <strong className="text-accent">Tip:</strong> open the <strong className="text-navy">Lesson</strong> tab — the AI tutor walks this subtopic interactively, card by card, shaped to your responses.
            </div>
          )}
        </div>

        {/* Diagrams */}
        {concept.diagrams.length > 0 && concept.diagrams.map((d, i) => (
          <div key={i} className="bg-white border border-rule rounded-md p-4">
            <div className="text-[9px] font-semibold text-slate uppercase tracking-wide mb-2">Diagram {i + 1}</div>
            <p className="text-[11px] text-slate mb-3 italic">{d.caption}</p>
            {d.type === 'mermaid' && (
              <MermaidDiagram source={d.source} id={`d-${i}`} />
            )}
            {d.type === 'svg' && (
              <div className="bg-cloud rounded p-3" dangerouslySetInnerHTML={{ __html: d.source }} />
            )}
            {d.type === 'image' && (
              <img src={d.source} alt={d.caption} className="rounded border border-rule" />
            )}
          </div>
        ))}

        {/* Quick CTAs to other tabs */}
        <div className="bg-gradient-to-br from-accent/10 to-gold/5 border border-accent/30 rounded-md p-4">
          <div className="text-[9px] font-semibold text-accent uppercase tracking-wide mb-2">When you're ready</div>
          <p className="text-xs text-slate mb-3">
            Discuss this concept with the AI tutor, or jump to graded practice items to test what you've absorbed.
          </p>
          <div className="text-[10px] text-slate space-y-1">
            <div>→ <strong className="text-navy">Tutor tab</strong> — Socratic Q&amp;A scoped to this concept</div>
            <div>→ <strong className="text-navy">Practice tab</strong> — graded items in this cluster</div>
          </div>
        </div>
      </aside>
    </div>
  )
}
