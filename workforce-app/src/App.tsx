import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './state/AuthContext'
import { Layout } from './components/Layout'
import { Toaster } from './components/Toast'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Roles from './pages/Roles'
import RoleNew from './pages/RoleNew'
import RoleDetail from './pages/RoleDetail'
import Market from './pages/Market'
import Calibrate from './pages/Calibrate'
import Discovery from './pages/Discovery'
import Pipeline from './pages/Pipeline'
// BC 128-133 — Notification centre (Phase D)
import NotificationsArchive from './pages/NotificationsArchive'
import NotificationSettings from './pages/NotificationSettings'

function Private({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="h-screen flex items-center justify-center text-slate text-sm">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
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
      <Route path="/signup" element={<Public><Signup /></Public>} />
      <Route element={<Private><Layout /></Private>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/market" element={<Market />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/roles/new" element={<RoleNew />} />
        <Route path="/roles/:id" element={<RoleDetail />} />
        <Route path="/roles/:id/calibrate" element={<Calibrate />} />
        <Route path="/roles/:id/discovery" element={<Discovery />} />
        <Route path="/roles/:id/pipeline" element={<Pipeline />} />
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
