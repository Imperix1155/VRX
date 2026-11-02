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
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '../i18n'
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
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'clipboard')
})

function stubClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true })
  return spy
}

/** A packaged build's stack: the install folder sits under the Windows account. */
const INSTALLED_FRAME =
  'file:///C:/Users/Sample%20User/AppData/Local/Programs/vrx/resources/app.asar/out/renderer/assets/index-abc123.js:12:345'

function InstalledBomb(): React.JSX.Element {
  const error = new Error(`Failed to load ${INSTALLED_FRAME}`)
  error.stack = `Error: boom\n    at Panel (${INSTALLED_FRAME})\n    at ${INSTALLED_FRAME}`
  throw error
}

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

  it('panel variant renders a compact fallback (no full-screen, no brand mark)', () => {
    const { container } = render(
      <ErrorBoundary variant="panel">
        <Bomb />
      </ErrorBoundary>
    )

    // Still a real fallback (heading + actions present)
    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined()
    // Compact: not full-screen, and no large app brand mark.
    expect(container.querySelector('.min-h-screen')).toBeNull()
    expect(screen.queryByLabelText('VRX')).toBeNull()
  })

  it('app variant (default) renders the full-screen fallback with the brand mark', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    expect(container.querySelector('.min-h-screen')).not.toBeNull()
    expect(screen.getByRole('img', { name: 'VRX' })).toBeDefined()
  })

  it('confirms a copy for a moment, then offers it again', async () => {
    vi.useFakeTimers()
    const writeText = stubClipboard(() => Promise.resolve())
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') }))
    await act(async () => {
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: i18n.t('error.copied') })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe(i18n.t('error.copied'))

    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') })).toBeDefined()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('says so when the copy fails, until the next try', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')))
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') }))

    expect((await screen.findByText(i18n.t('error.copyFailed'))).getAttribute('role')).toBe(
      'status'
    )
    expect(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') })).toBeDefined()
  })

  it('reports a failure when there is no clipboard at all', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') }))

    expect(screen.getByRole('status').textContent).toBe(i18n.t('error.copyFailed'))
  })

  it('leaves the install folder out of the copied diagnostics', () => {
    const writeText = stubClipboard(() => Promise.resolve())
    render(
      <ErrorBoundary>
        <InstalledBomb />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.copyDiagnostics') }))

    expect(writeText).toHaveBeenCalledOnce()
    const copied = String(writeText.mock.calls[0]?.[0])
    expect(copied).not.toMatch(/Sample|Users|AppData|file:/)
    expect(copied).toContain('Failed to load index-abc123.js:12:345')
    expect(copied).toContain('at Panel (index-abc123.js:12:345)')
  })
})
