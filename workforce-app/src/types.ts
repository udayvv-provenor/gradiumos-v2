export interface AuthTokens { accessToken: string; refreshToken: string }

export interface User { id: string; name: string; email: string; employerName: string; employerId: string; archetype?: string | null }

export interface Role {
  id: string; title: string
  // v3.1.1 — archetype is per-role, derived from JD on upload. Null until JD lands.
  archetype: string | null
  seatsPlanned: number
  applicantCount: number; createdAt: string
  status?: RoleStatus
  careerTrackId?: string
  careerTrackName?: string
  careerTrackCode?: string
  jdText?: string
  clusterTargets?: Record<string, number>
  extractedRequirements?: string[]
}

export interface CareerTrackGroup {
  careerTrackId: string
  careerTrackName: string
  careerTrackCode: string
  totalSeats: number
  totalApplicants: number
  roles: Role[]
  aggregatedDemand?: Record<string, number>
}

export interface Applicant {
  id: string; name: string; email: string
  matchScore: number; status: 'applied' | 'shortlisted' | 'decisioned'
  signalScore: number
}

export interface TalentCandidate {
  id: string; name: string; institution: string
  clusterMatch: number; signalScore: number; track: string
}

export interface KpiData { openRoles: number; applications: number; candidatesAboveThreshold: number }

// ─── BC 121/122 — Pipeline + Role lifecycle ──────────────────────────────────

export type RoleStatus = 'draft' | 'active' | 'paused' | 'closed'

export interface PipelineCandidate {
  id: string
  learnerId: string
  band: string
  matchScore: number
  status: string
  appliedAt: string
}

export interface PipelineCounts {
  Applied: number
  Shortlisted: number
  Interview: number
  Offer: number
  Accepted: number
  Declined: number
  Withdrawn: number
}

export interface PipelineResponse {
  counts: PipelineCounts
  applications: PipelineCandidate[]
}
