import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Toaster } from './Toast'
import { BellButton, NotificationDrawer } from './NotificationDrawer'
import { HelpDrawer } from './HelpDrawer'

// BC 171 — ? help button rendered here so state can manage HelpDrawer
function HelpButton({
  onClick,
  isOpen,
}: {
  onClick: () => void
  isOpen: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label="Help"
      aria-expanded={isOpen}
      className="relative flex items-center justify-center w-8 h-8 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      {/* Circle ? icon */}
      <svg
        className="w-[18px] h-[18px]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"
        />
        <circle cx="12" cy="17" r=".5" fill="currentColor" />
      </svg>
    </button>
  )
}

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // BC 173 — mobile sidebar visibility toggle
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const bellSlot = (
    <div className="flex items-center gap-1">
      <HelpButton onClick={() => setHelpOpen(true)} isOpen={helpOpen} />
      <BellButton onClick={() => setDrawerOpen(true)} />
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-cloud">
      {/* BC 173 — Mobile overlay when sidebar is open */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — hidden on mobile unless toggled */}
      <div
        className={[
          'fixed inset-y-0 left-0 z-40 md:static md:z-auto md:flex',
          mobileSidebarOpen ? 'flex' : 'hidden md:flex',
        ].join(' ')}
      >
        <Sidebar bellSlot={bellSlot} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* BC 173 — Mobile top bar with hamburger */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rule bg-white md:hidden">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open navigation menu"
            className="p-1.5 rounded-md text-slate hover:text-navy hover:bg-cloud transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {/* Hamburger icon */}
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-navy">GradiumOS</span>
          <div className="flex items-center gap-1">
            <HelpButton onClick={() => setHelpOpen(true)} isOpen={helpOpen} />
            <BellButton onClick={() => setDrawerOpen(true)} />
          </div>
        </div>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 lg:p-7 max-w-full">
          <Outlet />
        </main>
      </div>

      <Toaster />

      {/* Notification drawer */}
      <NotificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* BC 171 — Help drawer */}
      <HelpDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        portal="talent"
      />
    </div>
  )
}
