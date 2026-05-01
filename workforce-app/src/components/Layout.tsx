import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Toaster } from './Toast'
import { BellButton, NotificationDrawer } from './NotificationDrawer'
import { HelpDrawer } from './HelpDrawer'

// BC 171 — ? help button
function HelpButton({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label="Help"
      aria-expanded={isOpen}
      className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <circle cx="12" cy="17" r=".5" fill="currentColor" />
      </svg>
    </button>
  )
}

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const bellSlot = (
    <div className="flex items-center gap-1">
      <HelpButton onClick={() => setHelpOpen(true)} isOpen={helpOpen} />
      <BellButton onClick={() => setDrawerOpen(true)} />
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-cloud">
      <Sidebar bellSlot={bellSlot} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6 lg:p-7">
          <Outlet />
        </main>
      </div>
      <Toaster />
      <NotificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} portal="workforce" />
    </div>
  )
}
