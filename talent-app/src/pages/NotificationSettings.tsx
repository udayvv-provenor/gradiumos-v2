/**
 * BC 133 — Notification Settings (/settings/notifications)
 *
 * Per-event toggle for consent-gated events (N1-N12, N14, N15).
 * Transactional events (N5 terminal, N6, N11, N13) shown as locked "always on".
 * Preferences stored in localStorage (Phase D scope; DB-backed in Phase E).
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'

// ─── Event definitions ────────────────────────────────────────────────────────

interface EventDef {
  key: string
  label: string
  description: string
  transactional: boolean // cannot be toggled off
}

const EVENTS: EventDef[] = [
  { key: 'signal_unlocked',        label: 'Signal unlocked',           description: 'When your competency signal is first unlocked.',         transactional: false },
  { key: 'signal_band_improved',   label: 'Band improved',             description: 'When your signal band improves to a higher tier.',       transactional: false },
  { key: 'new_role_match',         label: 'New role match',            description: 'When a role matches your profile above 80%.',            transactional: false },
  { key: 'near_miss',              label: 'Near miss',                 description: 'When you are close to meeting a role\'s requirements.',  transactional: false },
  { key: 'application_status',     label: 'Application updates',       description: 'Status changes on your applications. Required for offer/rejection decisions.', transactional: true },
  { key: 'pathway_completed',      label: 'Pathway completed',         description: 'When you complete an augmentation pathway.',             transactional: true },
  { key: 'role_closed',            label: 'Role closed',               description: 'When a role you applied to is closed.',                  transactional: true },
  { key: 'shortlisted',            label: 'Shortlisted',               description: 'When you are shortlisted for a role.',                   transactional: false },
  { key: 'offer_decision',         label: 'Offer / rejection',         description: 'Final decisions on your applications.',                  transactional: true },
  { key: 'near_miss_digest',       label: 'Gap digest (weekly)',       description: 'Weekly summary of gaps to close for target roles.',      transactional: false },
]

const STORAGE_KEY = 'notification_prefs_talent'

type Prefs = Record<string, boolean>

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Prefs
  } catch { /* ignore */ }
  // Default: all enabled
  return EVENTS.reduce<Prefs>((acc, e) => { acc[e.key] = true; return acc }, {})
}

function savePrefs(prefs: Prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationSettings() {
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [saved, setSaved] = useState(false)

  // Keep localStorage in sync with state changes
  useEffect(() => {
    savePrefs(prefs)
  }, [prefs])

  function toggle(key: string) {
    setPrefs(p => ({ ...p, [key]: !p[key] }))
    setSaved(false)
  }

  function handleSave() {
    savePrefs(prefs)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-ink">Notification Preferences</h1>
          <p className="text-sm text-slate mt-0.5">Choose which notifications you receive</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="text-xs text-slate hover:text-ink transition-colors border border-rule rounded px-2.5 py-1.5"
        >
          Back
        </button>
      </div>

      <div className="bg-white rounded-xl border border-rule shadow-card overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-rule bg-cloud/60">
          <div className="text-xs font-semibold text-slate uppercase tracking-wide">Account notifications</div>
        </div>
        {EVENTS.map((evt, i) => (
          <div
            key={evt.key}
            className={clsx(
              'flex items-start gap-4 px-5 py-4',
              i < EVENTS.length - 1 && 'border-b border-rule/60',
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{evt.label}</span>
                {evt.transactional && (
                  <span
                    className="text-[10px] bg-rule/40 text-slate rounded px-1.5 py-0.5 font-medium"
                    title="Required for account activity — cannot be disabled"
                  >
                    Always on
                  </span>
                )}
              </div>
              <p className="text-xs text-slate mt-0.5 leading-relaxed">{evt.description}</p>
            </div>
            <button
              role="switch"
              aria-checked={evt.transactional ? true : !!prefs[evt.key]}
              disabled={evt.transactional}
              onClick={() => !evt.transactional && toggle(evt.key)}
              className={clsx(
                'relative flex-shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors duration-150',
                evt.transactional || prefs[evt.key] ? 'bg-accent' : 'bg-rule',
                evt.transactional && 'opacity-60 cursor-not-allowed',
                !evt.transactional && 'cursor-pointer',
              )}
            >
              <span
                className={clsx(
                  'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150',
                  (evt.transactional || prefs[evt.key]) ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate">
          Phase D: preferences stored locally.{' '}
          <span className="text-slate/60">Server-synced prefs arrive in Phase E.</span>
        </p>
        <button
          onClick={handleSave}
          className="text-sm font-medium bg-accent hover:bg-accent-dark text-white px-4 py-2 rounded-lg transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  )
}
