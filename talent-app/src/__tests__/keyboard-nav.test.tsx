/**
 * BC 166 — Keyboard navigation smoke test
 *
 * Verifies that the main nav links in the Sidebar are keyboard-reachable
 * (correct role, have text content, are not inert/disabled).
 *
 * Also verifies that the ConsentPanel toggle buttons have role="switch"
 * and are reachable by keyboard (tabIndex not explicitly -1).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../state/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Test User', institutionName: 'Test Uni', track: 'SWE' },
    logout: vi.fn(),
  }),
}))

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}))

import { Sidebar } from '../components/Sidebar'
import { ConsentPanel } from '../components/ConsentPanel'
import type { ConsentValues } from '../components/ConsentPanel'

// ─── Sidebar nav tests ───────────────────────────────────────────────────────

describe('BC 166 — Sidebar nav keyboard reachability', () => {
  it('renders all nav items as links (natively keyboard-focusable)', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    // Each nav item should be an <a> element rendered by NavLink
    const links = screen.getAllByRole('link')
    const navLabels = ['Dashboard', 'Market Intel', 'Profile', 'Portfolio', 'Learn', 'Assessments', 'Opportunities', 'Applications']
    for (const label of navLabels) {
      const link = links.find((l: HTMLElement) => l.textContent?.includes(label))
      expect(link, `Expected nav link "${label}" to exist`).toBeTruthy()
    }
  })

  it('logout button is keyboard-focusable (no negative tabIndex)', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    const logoutBtn = screen.getByRole('button', { name: /logout/i })
    expect(logoutBtn).not.toHaveAttribute('tabindex', '-1')
    expect(logoutBtn).not.toBeDisabled()
  })

  it('nav links can be reached by Tab key', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    // Tab through focusable elements — at least one nav link should be reachable
    await user.tab()
    const focused = document.activeElement
    // The focused element should be a link or button inside the sidebar
    expect(['A', 'BUTTON'].includes(focused?.tagName ?? '')).toBe(true)
  })
})

// ─── ConsentPanel keyboard tests ─────────────────────────────────────────────

describe('BC 166 — ConsentPanel toggle keyboard reachability', () => {
  const values: ConsentValues = {
    'assessment-grading': true,
    'tutor-ai': true,
    'opportunity-matching': true,
    analytics: false,
  }

  it('all toggle buttons have role="switch"', () => {
    render(<ConsentPanel values={values} onChange={() => undefined} />)
    const switches = screen.getAllByRole('switch')
    // 4 purposes
    expect(switches.length).toBe(4)
  })

  it('non-required toggle buttons are keyboard-focusable', () => {
    render(<ConsentPanel values={values} onChange={() => undefined} />)
    const switches = screen.getAllByRole('switch')
    // Non-disabled switches should not have tabIndex -1
    const nonRequired = switches.filter((s: HTMLElement) => !s.hasAttribute('disabled'))
    for (const sw of nonRequired) {
      expect(sw).not.toHaveAttribute('tabindex', '-1')
    }
  })

  it('non-required toggle can be activated with keyboard (Enter)', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<ConsentPanel values={values} onChange={handleChange} />)

    // Focus the "analytics" toggle (last, not required)
    const analyticsLabel = screen.getByText(/platform analytics/i)
    const analyticsSwitch = analyticsLabel.closest('div')?.querySelector('[role="switch"]') as HTMLElement
    expect(analyticsSwitch).toBeTruthy()

    analyticsSwitch.focus()
    await user.keyboard('{Enter}')
    expect(handleChange).toHaveBeenCalledWith('analytics', true)
  })
})
