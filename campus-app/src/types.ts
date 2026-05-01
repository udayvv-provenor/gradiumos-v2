export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface User {
  id: string
  name: string
  email: string
  institutionName: string
  institutionId: string
  inviteCode?: string
}

export interface KpiData {
  totalLearners: number
  averageReadiness: number
  averageConfidence?: number
  careerTracks: number
}

export interface CohortGapCluster {
  id: string
  name: string
  score: number
  pctBelow: number
  pctNear: number
  pctAbove: number
}

export type Archetype = 'Product' | 'Service' | 'MassRecruiter'

export interface CareerTrack {
  id: string
  name: string
  code: string
  archetype: Archetype
  learnerCount: number
  createdAt: string
}

export interface CurriculumSubject {
  name: string
  clusters: string[]
  coverage: number
}

export interface CurriculumResult {
  subjects: CurriculumSubject[]
  clusterCoverage: Record<string, number>
}

export interface Learner {
  id: string
  name: string
  email: string
  trackId: string
  trackName: string
  readiness: number
  joinedAt: string
}

export interface ApiError {
  message: string
  status?: number
}

/* ─── Gap report types ─────────────────────────────────────────────── */

export interface ClusterGap {
  clusterCode: string
  clusterName: string
  curriculumPct: number
  demandPct: number
  gapPct: number
  severity: 'critical' | 'moderate' | 'minor' | 'none'
}

export interface SubjectContribution {
  name: string
  coveragePct: number
  clusters: string[]
  gapImpact: number
}

export interface AugmentationSuggestion {
  area: string
  currentState: string
  recommendation: string
  effort: 'low' | 'medium' | 'high'
  exampleAction: string
}

export interface AggregatedDemand {
  careerTrackId: string
  careerTrackName: string
  clusterTargets: Record<string, number>
  sampleSize: number
  totalSeats: number
  topEmployers: { name: string; roleCount: number; seatTotal: number }[]
  lastRefreshedAt: string
}

// ─── BC 104 / BC 113 types ──────────────────────────────────────────────────

export type ClusterRecord = {
  C1: number; C2: number; C3: number; C4: number;
  C5: number; C6: number; C7: number; C8: number;
}

export interface CohortGap {
  cohortMedian: ClusterRecord | null
  employerP50: ClusterRecord
  gap: Record<string, number | null>
  inFlightAssignments: Record<string, number>
  learnerCount: number
}

export interface CohortLearner {
  learnerId: string
  name: string
  clusterScores: ClusterRecord
  band: 'Emerging' | 'Developing' | 'Proficient' | 'Advanced'
  signalConfidence: number
}

export interface CohortDrillResult {
  learners: CohortLearner[]
  total: number
  page: number
  pageSize: number
}

export interface LearnerRadar {
  learner: ClusterRecord
  cohortMedian: ClusterRecord | null
  employerBar: ClusterRecord
}

export interface BridgeToBar {
  cohortMedian: ClusterRecord | null
  employerP50: ClusterRecord
  gap: Record<string, number | null>
  dataState: 'Baseline' | 'Mixed' | 'Live'
  progressToLive: { current: number; required: number }
}

export interface GapReport {
  careerTrackId: string
  careerTrackName: string
  institutionId: string
  curriculumId: string | null
  demand: AggregatedDemand
  perCluster: ClusterGap[]
  topGapSubjects: SubjectContribution[]
  augmentations: AugmentationSuggestion[]
  overallReadiness: number
  computedAt: string
}
