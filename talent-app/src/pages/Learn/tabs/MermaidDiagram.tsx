import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

/**
 * Renders a mermaid diagram source string into an SVG.
 *
 * Why a separate component?
 *  - Mermaid 10+ uses an async render API; isolating the lifecycle keeps the
 *    parent ConceptTab declarative.
 *  - We initialise mermaid lazily on mount with `startOnLoad: false` so React
 *    controls the render — no DOM-walking auto-render that would conflict with
 *    the SPA route transitions.
 *  - We catch parser errors gracefully and fall back to the raw source in a
 *    code block so a malformed diagram never breaks the lesson.
 */
let mermaidInitialised = false
function ensureMermaid() {
  if (mermaidInitialised) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    themeVariables: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize:   '13px',
      primaryColor:        '#EFF6FF',
      primaryTextColor:    '#0F1A2E',
      primaryBorderColor:  '#0D9488',
      lineColor:           '#64748B',
      secondaryColor:      '#FAFAF9',
      tertiaryColor:       '#FFFFFF',
    },
  })
  mermaidInitialised = true
}

export default function MermaidDiagram({ source, id }: { source: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureMermaid()
    mermaid.render(`mermaid-${id}`, source)
      .then(({ svg }) => { if (!cancelled) { setSvg(svg); setError(null) } })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e)
          setError(msg)
        }
      })
    return () => { cancelled = true }
  }, [source, id])

  if (error) {
    return (
      <div>
        <div className="text-[10px] font-semibold text-amber-700 mb-1">Diagram could not be rendered — showing source.</div>
        <pre className="bg-navy text-white text-[10px] rounded p-3 overflow-x-auto leading-relaxed">{source}</pre>
        <div className="text-[9px] text-slate mt-1">Reason: {error.slice(0, 160)}</div>
      </div>
    )
  }

  if (!svg) {
    return <div className="text-[10px] text-slate italic py-3">Rendering diagram…</div>
  }

  return (
    <div
      ref={ref}
      className="bg-cloud rounded p-3 overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
