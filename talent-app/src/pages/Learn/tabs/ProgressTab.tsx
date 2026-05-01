import type { SubtopicProgress } from '../../../types'
import clsx from 'clsx'

/* ProgressTab — shows the learner what they've done on this subtopic and
 * where their mastery stands. Mastery is computed by learnService and
 * blends cluster score + attempts confidence (anchored to the IP formulas,
 * not invented here). */
export default function ProgressTab({ progress, subtopicName }: { progress: SubtopicProgress; subtopicName: string }) {
  const masteryPct = Math.round(progress.mastery * 100)
  const masteryLabel =
    masteryPct >= 70 ? 'Strong'
    : masteryPct >= 55 ? 'Developing'
    : masteryPct > 0 ? 'Needs work'
    : 'No data yet'

  return (
    <div className="grid grid-cols-2 gap-4 max-w-3xl">
      {/* Mastery card */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5">
        <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Your mastery on {subtopicName}</div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className={clsx(
            'text-3xl font-bold leading-none',
            masteryPct >= 70 ? 'text-green-700' : masteryPct >= 55 ? 'text-amber-600' : 'text-red-600'
          )}>{masteryPct}%</span>
          <span className="text-xs text-slate">{masteryLabel}</span>
        </div>
        <div className="h-2 bg-cloud rounded-full overflow-hidden mb-2">
          <div
            className={clsx('h-full rounded-full transition-all duration-700',
              masteryPct >= 70 ? 'bg-green-700' : masteryPct >= 55 ? 'bg-amber-500' : 'bg-red-600'
            )}
            style={{ width: `${masteryPct}%` }}
          />
        </div>
        <p className="text-[11px] text-slate leading-relaxed">
          Mastery anchors on your cluster score and modulates with attempts confidence. More attempts at higher scores → higher mastery.
        </p>
      </div>

      {/* Activity card */}
      <div className="bg-white border border-rule rounded-md shadow-card p-5">
        <div className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-3">Activity</div>
        <div className="flex flex-col gap-3">
          <Stat label="Practice attempts" value={progress.attemptsCount} />
          <Stat label="Best practice score" value={progress.bestScore > 0 ? `${progress.bestScore}%` : '—'} />
          <Stat label="Tutor sessions" value={progress.tutorSessions} />
          <Stat
            label="Last attempted"
            value={progress.lastAttemptAt ? new Date(progress.lastAttemptAt).toLocaleDateString() : 'Never'}
          />
        </div>
      </div>

      {/* Recommendation card */}
      <div className="col-span-2 bg-gradient-to-br from-accent/5 to-gold/5 border border-accent/20 rounded-md p-5">
        <div className="text-[10px] font-semibold text-accent uppercase tracking-wide mb-2">What to do next</div>
        <div className="text-sm text-ink leading-relaxed">
          {recommendation(progress)}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate">{label}</span>
      <span className="font-bold text-navy">{value}</span>
    </div>
  )
}

function recommendation(p: SubtopicProgress): string {
  if (p.attemptsCount === 0 && p.tutorSessions === 0) {
    return 'Start with the Concept tab, then drop into the Tutor for a quick discussion. After that, attempt 2-3 Practice items to anchor your understanding.'
  }
  if (p.tutorSessions === 0) {
    return 'You\'ve attempted some practice — open a Tutor session to discuss the items where you scored lower. The AI will probe your reasoning.'
  }
  if (p.attemptsCount === 0) {
    return 'You\'ve discussed this with the Tutor — now test what stuck by attempting Practice items. Aim for 60%+ on a descriptive item.'
  }
  if (p.bestScore < 60) {
    return 'Mastery is still developing. Re-read the Concept primer, then re-attempt your weakest Practice items. The AI feedback shows you the specific gaps.'
  }
  if (p.bestScore < 80) {
    return 'Good progress. Try the Apply capstone (when it lands) — it\'ll test synthesis under realistic conditions.'
  }
  return 'You\'re demonstrating strong mastery. Move on to a related subtopic in this cluster, or take on a harder cluster.'
}
