/**
 * BC 167 — ConsentPanel
 *
 * Renders the 4 data-processing purpose toggles that the learner can
 * grant or revoke.  Each toggle has a proper <label> + role="switch"
 * so it passes axe-core WCAG AA checks (BC 167).
 *
 * Props:
 *   values    — current grant state for each purpose key
 *   onChange  — called when the learner flips a toggle
 */

export type ConsentPurpose =
  | 'assessment-grading'
  | 'tutor-ai'
  | 'opportunity-matching'
  | 'analytics'

export interface ConsentValues {
  'assessment-grading': boolean
  'tutor-ai': boolean
  'opportunity-matching': boolean
  analytics: boolean
}

interface PurposeDef {
  key: ConsentPurpose
  label: string
  description: string
  required: boolean
}

const PURPOSES: PurposeDef[] = [
  {
    key: 'assessment-grading',
    label: 'Assessment grading',
    description: 'Required to score your answers and compute cluster scores. Cannot be disabled while you use assessments.',
    required: true,
  },
  {
    key: 'tutor-ai',
    label: 'AI Tutor augmentation',
    description: 'Allows the AI tutor to use your cluster gaps and lesson history to generate personalised explanations.',
    required: false,
  },
  {
    key: 'opportunity-matching',
    label: 'Opportunity matching',
    description: 'Uses your Signal to surface and rank employer roles. Disabling hides match scores and pauses new-match alerts.',
    required: false,
  },
  {
    key: 'analytics',
    label: 'Platform analytics',
    description: 'Aggregated, anonymised usage data to improve GradiumOS. No individual scores are shared externally.',
    required: false,
  },
]

interface ConsentPanelProps {
  values: ConsentValues
  onChange: (purpose: ConsentPurpose, granted: boolean) => void
}

export function ConsentPanel({ values, onChange }: ConsentPanelProps) {
  return (
    <section aria-labelledby="consent-heading">
      <h2
        id="consent-heading"
        className="text-sm font-semibold text-navy mb-1"
      >
        Data processing consent
      </h2>
      <p className="text-xs text-slate mb-4">
        Control how GradiumOS uses your data. Required purposes cannot be disabled.
      </p>

      <div className="space-y-3">
        {PURPOSES.map((p) => {
          const checked = p.required ? true : !!values[p.key]
          const toggleId = `consent-toggle-${p.key}`
          const labelId = `consent-label-${p.key}`
          const descId = `consent-desc-${p.key}`
          return (
            <div
              key={p.key}
              className="flex items-start gap-4 bg-white border border-rule rounded-md px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <label
                  id={labelId}
                  htmlFor={toggleId}
                  className="text-sm font-medium text-ink cursor-pointer"
                >
                  {p.label}
                  {p.required && (
                    <span className="ml-2 text-[10px] bg-rule/40 text-slate rounded px-1.5 py-0.5 font-medium">
                      Required
                    </span>
                  )}
                </label>
                <p id={descId} className="text-xs text-slate mt-0.5 leading-relaxed">
                  {p.description}
                </p>
              </div>

              {/* Toggle — role="switch" with proper aria attrs for axe */}
              <button
                id={toggleId}
                role="switch"
                aria-checked={checked}
                aria-labelledby={labelId}
                aria-describedby={descId}
                disabled={p.required}
                onClick={() => !p.required && onChange(p.key, !values[p.key])}
                onKeyDown={(e) => {
                  // BC 166 — activate on Enter or Space (native button handles Space already,
                  // but explicit handling keeps behaviour consistent for role="switch")
                  if (!p.required && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onChange(p.key, !values[p.key])
                  }
                }}
                className={[
                  'relative flex-shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors duration-150',
                  checked ? 'bg-accent' : 'bg-rule',
                  p.required ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}
              >
                <span className="sr-only">
                  {checked ? 'Enabled' : 'Disabled'}
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150',
                    checked ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')}
                />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
