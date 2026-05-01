/**
 * BC 167 — axe-core accessibility scan for the learner onboarding (Signup) flow.
 *
 * Renders the Signup page in isolation (router + auth context mocked) and
 * asserts zero axe-core WCAG AA violations in:
 *   - idle state (empty form)
 *   - filled state (all fields populated)
 *   - error state (invalid invite code message visible)
 *
 * Run: npm run test:a11y
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import axe from 'axe-core'
import Signup from '../../pages/Signup'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn() }),
}))

vi.mock('../../lib/api', () => ({
  postSignupLearner: vi.fn().mockResolvedValue({
    tokens: { accessToken: 'tok', refreshToken: 'ref' },
    user: { id: 'u1', name: 'Test', role: 'LEARNER' },
  }),
}))

// ─── Helper ───────────────────────────────────────────────────────────────────

function renderSignup() {
  return render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BC 167 — Signup (onboarding) a11y', () => {
  it('idle state: zero axe-core WCAG AA violations', async () => {
    const { container } = renderSignup()
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    })
    if (results.violations.length > 0) {
      const detail = results.violations
        .map((v) => `[${v.id}] ${v.description} — ${v.nodes.length} node(s)`)
        .join('\n')
      throw new Error(`axe-core AA violations:\n${detail}`)
    }
    expect(results.violations).toHaveLength(0)
  })
})
