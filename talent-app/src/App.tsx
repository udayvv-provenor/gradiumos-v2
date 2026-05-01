import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './state/AuthContext'
import { apiFetch } from './lib/api'
import { Layout } from './components/Layout'
import { Toaster } from './components/Toast'
import Login from './pages/Login'
// v3.1.3 — public Talent signup REMOVED. Per Uday's call: access is granted
// by the institution. Dean either adds the learner via Campus → Learners
// (auto-generated temp password) OR shares the institution invite code so
// the learner self-binds via /api/auth/signup/learner. The Login page now
// has a "Got an invite code?" CTA inline (no public signup form).
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import Assessments from './pages/Assessments'
import AssessmentTake from './pages/AssessmentTake'
// v3.1.9 — standalone AI Tutor REMOVED per Uday: "Learn and AI tutor overlap.
// Why allow them to ask anything they want — it's only to close gaps, so we
// augment via Learn." The tutor still exists IN-CONTEXT inside the Lesson
// stream (per-subtopic, gap-driven) and inside the Shift drawer (per-artifact,
// work-simulation grounded). It is no longer a free-form chat surface.
import Opportunities from './pages/Opportunities'
import Applications from './pages/Applications'
import LearnIndex from './pages/Learn/Index'
import LearnSubtopic from './pages/Learn/Subtopic'
import Profile from './pages/Profile'
import PathMap from './pages/PathMap'
import Market from './pages/Market'
import Shift from './pages/Shift'
// BC 128-133 — Notification centre (Phase D)
import NotificationsArchive from './pages/NotificationsArchive'
import NotificationSettings from './pages/NotificationSettings'

function Private({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="h-screen flex items-center justify-center text-slate text-sm">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/* v3.1.7 — Uday's #3: first action after login MUST be resume upload.
 * Without it, augmentation plans assume college gaps == student gaps, which
 * is wrong (the student may have learned it elsewhere). This guard redirects
 * any first-time learner to /profile when they hit a route whose value
 * fundamentally depends on their personal evidence (Learn paths, augmentation,
 * 3-way map). Other routes (Dashboard, Opportunities, Tutor, Market) are
 * allowed pre-resume since they show generic / live data.
 *
 * Bypassed by ?skip=1 (escape hatch for testing). */
const GATED_ROUTES = ['/learn', '/path', '/assessments']  // fundamentally need resume to be useful

function ResumeFirstGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const onGatedRoute = GATED_ROUTES.some((r) => location.pathname.startsWith(r))
  const onProfile = location.pathname.startsWith('/profile')
  const skip      = new URLSearchParams(location.search).get('skip') === '1'

  // v3.1.10 — staleTime 0 + refetchOnMount: 'always'. The earlier 60s stale
  // window meant: upload resume → navigate to Learn within 60s → gate sees
  // STALE null profile → redirects you back to /profile. Bug Uday hit.
  const profileQ = useQuery({
    queryKey: ['my-profile-gate'],
    queryFn:  () => apiFetch<{ profile: unknown | null }>('/api/talent/me/profile'),
    enabled:  !!user && onGatedRoute && !skip,
    staleTime: 0,
    refetchOnMount: 'always',
  } as Parameters<typeof useQuery>[0]) as { data: { profile: unknown | null } | undefined; isLoading: boolean }

  // Open routes (non-gated, profile, skip-flag) → always allowed
  if (!user || !onGatedRoute || onProfile || skip) return <>{children}</>
  if (profileQ.isLoading) return <>{children}</>      // don't flash a redirect during fetch
  if (profileQ.data && profileQ.data.profile === null) {
    return <Navigate to="/profile?welcome=1" replace />
  }
  return <>{children}</>
}
function Public({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Public><Login /></Public>} />
      {/* v3.1.3 — /signup redirects to /login (invite-only access) */}
      <Route path="/signup" element={<Navigate to="/login" replace />} />
      {/* v3.1.5 — /shift renders OUTSIDE Layout chrome — full-screen work simulation */}
      <Route path="/shift" element={<Private><Shift /></Private>} />
      <Route element={<Private><ResumeFirstGate><Layout /></ResumeFirstGate></Private>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/market" element={<Market />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/path/:careerTrackId" element={<PathMap />} />
        <Route path="/learn" element={<LearnIndex />} />
        <Route path="/learn/:cluster/:subtopic" element={<LearnSubtopic />} />
        <Route path="/assessments" element={<Assessments />} />
        <Route path="/assessments/:bankItemId/take" element={<AssessmentTake />} />
        {/* v3.1.9 — /tutor route DEAD; redirect to Learn (gap-driven augmentation) */}
        <Route path="/tutor" element={<Navigate to="/learn" replace />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/applications" element={<Applications />} />
        {/* BC 128-133 — Notification pages (Phase D) */}
        <Route path="/notifications/archive" element={<NotificationsArchive />} />
        <Route path="/settings/notifications" element={<NotificationSettings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster />
      </BrowserRouter>
    </AuthProvider>
  )
}
