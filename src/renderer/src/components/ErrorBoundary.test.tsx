// @vitest-environment jsdom
/**
 * ErrorBoundary tests (VRX-127 / VRX-127 follow-up).
 *
 * Needs a real DOM because React error boundaries only fire during the
 * client commit phase — renderToStaticMarkup (SSR) has no commit phase and
 * would just re-throw rather than catching. Hence: @vitest-environment jsdom
 * and @testing-library/react.
 *
 * @testing-library/react was added to devDependencies for this test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '../i18n'
import ErrorBoundary from './ErrorBoundary'

// Suppress the expected React error noise from the throwing child.
// React always calls console.error for caught boundary errors; this is
// expected and not a real test failure.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  // Explicit cleanup needed because vitest doesn't auto-wire @testing-library
  // cleanup without a setupFiles entry.
  cleanup()
})

// Silence electron-log/renderer in the test environment (no IPC bridge).
vi.mock('electron-log/renderer', () => ({
  default: { error: vi.fn() }
}))

function Bomb(): React.JSX.Element {
  throw new Error('test render error')
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <span>healthy child</span>
      </ErrorBoundary>
    )

    expect(screen.getByText('healthy child')).toBeDefined()
  })

  it('renders the fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    // The heading is the primary signal the fallback rendered.
    expect(screen.getByText('Something went wrong')).toBeDefined()
  })

  it('shows a Reload button in the fallback', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined()
  })

  it('shows a Copy diagnostics button in the fallback', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByRole('button', { name: 'Copy diagnostics' })).toBeDefined()
  })

  it('a per-panel boundary fallback does not affect siblings', () => {
    // Render a sibling outside the boundary alongside a crashing panel.
    // The sibling must remain visible once the boundary catches the error.
    render(
      <>
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
        <span>sibling content</span>
      </>
    )

    // Fallback rendered for the panel that threw
    expect(screen.getByText('Something went wrong')).toBeDefined()
    // Sibling outside the boundary is unaffected
    expect(screen.getByText('sibling content')).toBeDefined()
  })
})
