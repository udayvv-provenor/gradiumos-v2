/**
 * RadarChart — 8-cluster spider/radar visualisation. Pure SVG; no chart library.
 *
 * v3.1.3 — added per Uday's feedback: "spider graphs — heavily discussed in
 * our demo builds almost as good as IP". Used wherever cluster scores or
 * cluster targets are shown alongside another series (curriculum vs demand,
 * learner vs role, etc.). Two-series version supports the most common shape.
 *
 * Renders an octagon polygon with C1..C8 axes (every 45°). Each `series`
 * draws a filled translucent polygon + outer line. Threshold rings every
 * 25% (light grey). Cluster labels at the outer rim.
 */
import clsx from 'clsx'

type Series = {
  label: string
  color: 'violet' | 'amber' | 'green' | 'red' | 'blue'
  values: number[]   // 8 values, 0..100, in order C1..C8
}

const COLORS: Record<Series['color'], { stroke: string; fill: string; text: string }> = {
  violet: { stroke: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.20)',  text: 'text-violet-700' },
  amber:  { stroke: '#F59E0B', fill: 'rgba(245, 158, 11, 0.20)',  text: 'text-amber-700' },
  green:  { stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.20)',  text: 'text-green-700' },
  red:    { stroke: '#EF4444', fill: 'rgba(239, 68, 68, 0.20)',   text: 'text-red-700' },
  blue:   { stroke: '#3B82F6', fill: 'rgba(59, 130, 246, 0.20)',  text: 'text-blue-700' },
}

const CLUSTER_LABELS = [
  'C1\nCore Tech',
  'C2\nProblem Solving',
  'C3\nExecution',
  'C4\nSystems',
  'C5\nCommunication',
  'C6\nDomain',
  'C7\nOwnership',
  'C8\nAgility',
]

export function RadarChart({
  series,
  size = 360,
  showLabels = true,
}: {
  series: Series[]
  size?: number
  showLabels?: boolean
}) {
  const cx = size / 2
  const cy = size / 2
  const radius = Math.min(cx, cy) - (showLabels ? 60 : 20)
  const ANGLES = Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + i * (Math.PI / 4))   // start C1 at top

  function pointAt(value: number, axisIdx: number): [number, number] {
    const r = (value / 100) * radius
    return [cx + r * Math.cos(ANGLES[axisIdx]), cy + r * Math.sin(ANGLES[axisIdx])]
  }

  function polygonPoints(values: number[]): string {
    return values.map((v, i) => pointAt(v, i).join(',')).join(' ')
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        {/* Threshold rings: 25%, 50%, 75%, 100% */}
        {[0.25, 0.5, 0.75, 1].map((frac, ringIdx) => (
          <polygon
            key={frac}
            points={ANGLES.map((_, i) => pointAt(frac * 100, i).join(',')).join(' ')}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={ringIdx === 3 ? 1.2 : 0.6}
          />
        ))}
        {/* Axis lines */}
        {ANGLES.map((a, i) => (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={cx + radius * Math.cos(a)}
            y2={cy + radius * Math.sin(a)}
            stroke="#E5E7EB"
            strokeWidth={0.6}
          />
        ))}
        {/* Series polygons */}
        {series.map((s, sIdx) => {
          const c = COLORS[s.color]
          const pts = polygonPoints(s.values)
          return (
            <g key={sIdx}>
              <polygon points={pts} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
              {/* Series points */}
              {s.values.map((v, i) => {
                const [x, y] = pointAt(v, i)
                return <circle key={i} cx={x} cy={y} r={2.5} fill={c.stroke} />
              })}
            </g>
          )
        })}
        {/* Cluster labels at rim */}
        {showLabels && CLUSTER_LABELS.map((lbl, i) => {
          const [x, y] = pointAt(118, i)
          const lines = lbl.split('\n')
          // text-anchor: roughly based on octant to avoid overlap with axis
          const a = ANGLES[i]
          const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-slate text-[10px] font-medium"
            >
              {lines.map((line, li) => (
                <tspan key={li} x={x} dy={li === 0 ? 0 : 11}>{line}</tspan>
              ))}
            </text>
          )
        })}
      </svg>
      {/* Legend */}
      {series.length > 0 && (
        <div className="flex gap-4 mt-2 text-[11px]">
          {series.map((s, i) => {
            const c = COLORS[s.color]
            return (
              <div key={i} className={clsx('flex items-center gap-1.5', c.text)}>
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: c.stroke }} />
                <span className="font-semibold">{s.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
