import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './state/AuthContext'
import { Layout } from './components/Layout'
import { Toaster } from './components/Toast'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import CareerTracks from './pages/CareerTracks'
import CareerTrackNew from './pages/CareerTrackNew'
import CareerTrackDetail from './pages/CareerTrackDetail'
import GapReport from './pages/GapReport'
import Learners from './pages/Learners'
import Market from './pages/Market'
import CohortGapDrillDown from './pages/CohortGapDrillDown'
// BC 128-133 — Notification centre (Phase D)
import NotificationsArchive from './pages/NotificationsArchive'
import NotificationSettings from './pages/NotificationSettings'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="h-screen flex items-center justify-center text-slate text-sm">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (user) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
      <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/market" element={<Market />} />
        <Route path="/career-tracks" element={<CareerTracks />} />
        <Route path="/career-tracks/new" element={<CareerTrackNew />} />
        <Route path="/career-tracks/:id" element={<CareerTrackDetail />} />
        <Route path="/career-tracks/:careerTrackId/gap-report" element={<GapReport />} />
        <Route path="/career-tracks/:id/cohort-gap" element={<CohortGapDrillDown />} />
        <Route path="/learners" element={<Learners />} />
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
