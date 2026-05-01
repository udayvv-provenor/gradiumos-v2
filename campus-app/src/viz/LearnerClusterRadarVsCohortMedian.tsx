/**
 * BC 115 — LearnerClusterRadarVsCohortMedian
 * BC 170 — ARIA labels on SVG + aria-live announcer
 *
 * Radar chart: learner cluster scores vs cohort median.
 * Used on the campus-app learner drill-down (BC 108).
 *
 * Props:
 *   data  — two series, each with 8 values (C1..C8, 0..100) and a label
 *   size  — SVG canvas size (default 360)
 */
import { useEffect, useRef } from 'react'

interface RadarSeries {
  data: number[]   // 8 values, 0..100, in order C1..C8
  label: string
}

const CLUSTER_LABELS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']
const SERIES_COLORS = [
  { stroke: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.18)', text: '#6D28D9' },  // violet — learner
  { stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.18)',  text: '#047857' },  // green — cohort median
]

export function LearnerClusterRadarVsCohortMedian({
  data,
  size = 360,
}: {
  data: [RadarSeries, RadarSeries]
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const radius = Math.min(cx, cy) - 54
  const ANGLES = Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + i * (Math.PI / 4))

  // BC 170 — aria-live announcer
  const liveRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!liveRef.current) return
    const learnerAvg = Math.round(data[0].data.reduce((s, v) => s + v, 0) / data[0].data.length)
    const cohortAvg = Math.round(data[1].data.reduce((s, v) => s + v, 0) / data[1].data.length)
    liveRef.current.textContent =
      `Radar chart updated. ${data[0].label} average: ${learnerAvg}. ${data[1].label} average: ${cohortAvg}.`
  }, [data])

  function pointAt(value: number, axisIdx: number): [number, number] {
    const r = (value / 100) * radius
    return [cx + r * Math.cos(ANGLES[axisIdx]), cy + r * Math.sin(ANGLES[axisIdx])]
  }

  function polygonPoints(values: number[]): string {
    return values.map((v, i) => pointAt(v, i).join(',')).join(' ')
  }

  const titleText = `Radar chart: ${data[0].label} cluster scores vs ${data[1].label}`

  return (
    <div className="flex flex-col items-center">
      {/* BC 170 — visually hidden live region */}
      <span
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={titleText}
      >
        {/* BC 170 — <title> for screen readers */}
        <title>{titleText}</title>

        {/* Grid rings: 25 / 50 / 75 / 100 */}
        {[0.25, 0.5, 0.75, 1].map((frac, ri) => (
          <polygon
            key={frac}
            points={ANGLES.map((_, i) => pointAt(frac * 100, i).join(',')).join(' ')}
            fill="none"
            stroke="#E5E7EB"
            strokeWidth={ri === 3 ? 1.2 : 0.6}
          />
        ))}
        {/* Axis spokes */}
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
        {data.map((s, si) => {
          const col = SERIES_COLORS[si] ?? SERIES_COLORS[0]
          return (
            <g key={si}>
              <polygon
                points={polygonPoints(s.data)}
                fill={col.fill}
                stroke={col.stroke}
                strokeWidth={1.6}
              />
              {s.data.map((v, i) => {
                const [x, y] = pointAt(v, i)
                return <circle key={i} cx={x} cy={y} r={2.5} fill={col.stroke} />
              })}
            </g>
          )
        })}
        {/* Cluster labels */}
        {CLUSTER_LABELS.map((lbl, i) => {
          const [x, y] = pointAt(112, i)
          const a = ANGLES[i]
          const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'
          return (
            <text
              key={i}
              x={x} y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10}
              fill="#64748B"
              fontWeight={500}
            >
              {lbl}
            </text>
          )
        })}
      </svg>
      {/* Legend */}
      <div className="flex gap-4 mt-2 text-[11px]" aria-hidden="true">
        {data.map((s, i) => {
          const col = SERIES_COLORS[i] ?? SERIES_COLORS[0]
          return (
            <div key={i} className="flex items-center gap-1.5" style={{ color: col.text }}>
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: col.stroke }} />
              <span className="font-semibold">{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
