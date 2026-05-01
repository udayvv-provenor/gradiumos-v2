export interface AuthTokens { accessToken: string; refreshToken: string }

export interface User {
  id: string; name: string; email: string
  institutionName: string; track: string; inviteCode: string
}

export interface ClusterScore {
  id: string; name: string; score: number
  confidence: number; band: 'Above' | 'Near' | 'Below'
}

export interface AssessmentBankItem {
  id: string; title: string; cluster: string; clusterName: string
  type: 'MCQ' | 'Descriptive'; difficulty: 'Easy' | 'Medium' | 'Hard'
  attempted: boolean; lastScore?: number
}

export interface MCQOption { id: string; text: string }

export interface AssessmentQuestion {
  id: string; type: 'MCQ' | 'Descriptive'
  questionText: string; options?: MCQOption[]
  cluster: string; clusterName: string
}

export interface AttemptResult {
  score: number; correct?: boolean; correctOptionId?: string
  feedback?: { strengths: string[]; gaps: string[]; suggestions: string[] }
}

export interface TutorSession { id: string; cluster: string; topic: string }

export interface TutorMessage { role: 'user' | 'assistant'; content: string }

export interface TutorSummary { conceptsCovered: string[]; suggestedNextSteps: string[] }

export interface Opportunity {
  id: string; title: string; employerName: string
  archetype: string | null     // v3.1.3 — null for external (Serper) postings
  matchPct: number; signalBandRequired: string; applied: boolean
  // v3.1.3 — external job-board postings have source + url + location
  source?: 'platform' | 'serper-linkedin' | 'serper-naukri'
  url?: string | null
  location?: string | null
  postedDate?: string | null
}

export interface SignalData {
  score: number; band: 'locked' | 'bronze' | 'silver' | 'gold'; unlocked: boolean
}

// ─── BC 76-78 — Signal dashboard ────────────────────────────────────────────

export type ConfidenceBand = 'green' | 'amber' | 'grey' | 'suppressed'
export type SignalBand = 'Emerging' | 'Developing' | 'Proficient' | 'Advanced'

export interface ClusterBar {
  clusterCode: string
  clusterName: string
  scoreWeighted: number
  confidence: number
  confidenceBand: ConfidenceBand
  suppressed: boolean
}

export interface SignalDashboard {
  clusterBars: ClusterBar[]
  signalScore: number
  signalBand: SignalBand
  overallConfidence: number
  suppressed: boolean
}

// ─── BC 79 — Gaps ────────────────────────────────────────────────────────────

export interface GapCluster {
  clusterCode: string
  clusterName: string
  scoreWeighted: number
  confidence: number
  pathwayExists: boolean
}

export interface GapsData { gaps: GapCluster[] }

// ─── BC 80 — Trajectory ──────────────────────────────────────────────────────

export interface TrajectoryPoint { score: number; submittedAt: string }
export interface TrajectoryData { trajectory: TrajectoryPoint[] }

// ─── BC 81-85 — Enhanced opportunities ──────────────────────────────────────

export interface NearMissDetail { gaps: { clusterCode: string; delta: number }[] }
export interface NearMissPathway { clusterCode: string; pathwayId: string | null }

export interface OpportunityV2 {
  roleId: string
  title: string
  employerName: string
  matchScore: number
  careerTrackCode: string
  city: string | null
  nearMiss: boolean
  nearMissDetails: NearMissDetail | null
  nearMissPathway: NearMissPathway | null
  newMatch: boolean
}

export interface OpportunitiesV2Response { opportunities: OpportunityV2[] }

// ─── BC 120 — Application lifecycle ─────────────────────────────────────────

export type ApplicationStatus =
  | 'Applied'
  | 'Shortlisted'
  | 'Interview'
  | 'Offer'
  | 'Accepted'
  | 'Declined'
  | 'Withdrawn'

export interface ApplicationRecord {
  id: string
  roleId: string
  roleTitle: string
  employerName: string
  status: ApplicationStatus
  appliedAt: string
  statusUpdatedAt: string
  nextAction: string
}

export interface ApplicationsResponse { applications: ApplicationRecord[] }

/* ─── Learning portal types ─────────────────────────────────────────── */

export interface LearnSubtopicSummary {
  code: string
  name: string
  clusterCode: string
  required: boolean
  authored: boolean
  practiceCount: number
  // v3.1 — track relevance + sequential mastery gating
  tracks?: string[]               // canonical career tracks this subtopic serves
  relevant?: boolean              // true if learner's chosen track ∈ tracks
  unlocked?: boolean              // false → predecessor mastery < threshold
  lockReason?: string             // human-readable lock explanation
  mastery?: number                // 0..1
}

export interface LearnClusterGroup {
  clusterCode: string
  score: number
  confidence: number
  subtopics: LearnSubtopicSummary[]
}

export interface LearnIndex {
  clusters: LearnClusterGroup[]
  recommended: { cluster: string; subtopic: string; name: string } | null
  // v3.1 — context: learner's chosen canonical track, unlock-rule threshold (%)
  learnerTrack?: string | null
  unlockThresholdPct?: number
}

export interface ConceptDiagram {
  type: 'mermaid' | 'svg' | 'image'
  caption: string
  source: string
}

export interface SubtopicConcept {
  subtopicCode: string
  title: string
  subtitle: string
  estimatedReadMinutes: number
  markdown: string
  diagrams: ConceptDiagram[]
  tutorOpener: string
  authored: boolean
}

export interface SubtopicPracticeItem {
  id: string; title: string; kind: 'mcq' | 'descriptive' | 'coding' | 'simulation'
  clusterCode: string; timeLimitSec: number
}

export interface SubtopicProgress {
  attemptsCount: number
  bestScore: number
  lastAttemptAt: string | null
  mastery: number       // 0..1
  tutorSessions: number
}

export interface SubtopicPayload {
  subtopic: { code: string; name: string; clusterCode: string; required: boolean }
  concept: SubtopicConcept
  practice: SubtopicPracticeItem[]
  apply: null | { id: string; prompt: string }   // wired in Session 2
  progress: SubtopicProgress
}

/* ─── Lesson Stream (unique tutor) types ─────────────────────────── */

export type LessonCardKind = 'explanation' | 'question' | 'example' | 'reflection' | 'check' | 'detour'

export interface LessonCard {
  kind: LessonCardKind
  title: string
  body: string
  example?: { before?: string; after?: string; callout?: string }
  check?: { options: { id: string; text: string }[]; correctId: string; explanation: string }
  question?: { prompt: string; placeholder?: string }
  annotations?: { label: string; text: string }[]
  conceptTags?: string[]
  awaitsLearner: boolean
}

export interface LessonCardEntry {
  card: LessonCard
  learnerInput?: string                  // present once the learner has interacted
  pickedOptionId?: string                // for check cards
  isComplete?: boolean                   // marked when learner moves on
}

/* ─── Talent Profile + Path types ────────────────────────────────── */

export interface ResumeProfile {
  candidateName?: string
  yearsExp: number
  archetype: 'Product' | 'Service' | 'MassRecruiter' | 'Unknown'
  clusterScores: Record<string, number>
  clusterConfidence: Record<string, number>
  declaredSkills: string[]
  experienceSummary: string
  evidenceHighlights: string[]
}

export interface TrackRecommendation {
  careerTrackId: string
  careerTrackName: string
  fitPct: number
  topMatchedClusters: { code: string; resume: number; demand: number; fit: number }[]
  topGapClusters: { code: string; resume: number; demand: number; gap: number }[]
  reasoning: string
}

export interface ThreeWayMapRow {
  clusterCode: string
  clusterName: string
  current: number
  currentConfidence: number
  collegeEventual: number
  demand: number
  gapVsDemand: number
  bridgeNeeded: boolean
  permanentGap: boolean
}

export interface ThreeWayMap {
  learnerId: string
  careerTrackId: string
  careerTrackName: string
  rows: ThreeWayMapRow[]
  overallReadiness: number
  computedAt: string
  hasResume: boolean
  hasCurriculum: boolean
}

export interface PathItem {
  subtopicCode: string
  subtopicName: string
  clusterCode: string
  rationale: 'permanent_gap' | 'bridge_pre_college' | 'reinforce_weakness'
  priority: number
  inCollegeCurriculum: boolean
}

export interface AugmentationPath {
  learnerId: string
  careerTrackId: string
  careerTrackName: string
  permanentGapItems: PathItem[]
  bridgeItems: PathItem[]
  reinforcementItems: PathItem[]
  totalEstimatedHours: number
}
