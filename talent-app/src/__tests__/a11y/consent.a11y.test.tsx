/**
 * BC 167 — axe-core accessibility scan for the consent UI surface.
 *
 * Renders ConsentPanel (the 4 data-purpose toggles) and asserts
 * zero axe-core WCAG AA violations.
 *
 * Stack: Vitest + @testing-library/react + axe-core
 * Run: npm run test:a11y
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import axe from 'axe-core'
import { ConsentPanel } from '../../components/ConsentPanel'
import type { ConsentValues } from '../../components/ConsentPanel'

const defaultValues: ConsentValues = {
  'assessment-grading': true,
  'tutor-ai': true,
  'opportunity-matching': true,
  analytics: false,
}

describe('BC 167 — ConsentPanel a11y', () => {
  it('renders with zero axe-core violations (all granted)', async () => {
    const { container } = render(
      <ConsentPanel values={defaultValues} onChange={() => undefined} />,
    )
    const results = await axe.run(container)
    expect(results.violations).toHaveLength(0)
  })

  it('renders with zero axe-core violations (all revoked)', async () => {
    const allRevoked: ConsentValues = {
      'assessment-grading': true,  // required — cannot revoke
      'tutor-ai': false,
      'opportunity-matching': false,
      analytics: false,
    }
    const { container } = render(
      <ConsentPanel values={allRevoked} onChange={() => undefined} />,
    )
    const results = await axe.run(container)
    expect(results.violations).toHaveLength(0)
  })
})
