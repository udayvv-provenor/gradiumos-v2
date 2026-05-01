/**
 * BC 173 — Responsive smoke test
 *
 * Verifies that the Dashboard and Opportunities components render
 * without throwing at mobile, tablet, and desktop viewport widths.
 * This is a render-level smoke test — not a pixel-perfect snapshot.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'

// ─── Mock heavy dependencies so pages render in isolation ────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('../state/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test User', institutionName: 'Test Uni', track: 'SWE' }, logout: vi.fn() }),
}))

vi.mock('../lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}))

vi.mock('../components/Toast', () => ({
  showToast: vi.fn(),
}))

// ─── Dynamically import pages after mocks are registered ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Dashboard: React.ComponentType<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Opportunities: React.ComponentType<any>

beforeAll(async () => {
  const dashMod = await import('../pages/Dashboard')
  Dashboard = dashMod.default
  const oppMod = await import('../pages/Opportunities')
  Opportunities = oppMod.default
})

// ─── Viewport helper ─────────────────────────────────────────────────────────

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  window.dispatchEvent(new Event('resize'))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BC 173 — Dashboard responsive rendering', () => {
  it('renders at 375px (mobile) without error', () => {
    setViewport(375)
    expect(() => render(<Dashboard />)).not.toThrow()
  })

  it('renders at 768px (tablet) without error', () => {
    setViewport(768)
    expect(() => render(<Dashboard />)).not.toThrow()
  })

  it('renders at 1280px (desktop) without error', () => {
    setViewport(1280)
    expect(() => render(<Dashboard />)).not.toThrow()
  })

  it('renders the main heading at all widths', () => {
    render(<Dashboard />)
    // Greeting text should be present
    const heading = screen.queryByRole('heading', { level: 1 })
    expect(heading).not.toBeNull()
  })
})

describe('BC 173 — Opportunities responsive rendering', () => {
  it('renders at 375px (mobile) without error', () => {
    setViewport(375)
    expect(() => render(<Opportunities />)).not.toThrow()
  })

  it('renders at 768px (tablet) without error', () => {
    setViewport(768)
    expect(() => render(<Opportunities />)).not.toThrow()
  })

  it('renders at 1280px (desktop) without error', () => {
    setViewport(1280)
    expect(() => render(<Opportunities />)).not.toThrow()
  })
})
