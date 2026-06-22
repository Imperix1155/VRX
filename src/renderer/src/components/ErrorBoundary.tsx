import { Component } from 'react'
import { useTranslation } from 'react-i18next'
import logRenderer from 'electron-log/renderer'

// Fallback UI is a functional component so it can call useTranslation
// (hooks cannot be called inside class components).
function ErrorFallback(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center px-[var(--space-4)] py-[var(--space-10)]">
      <div className="glass relative w-full max-w-sm overflow-hidden rounded-panel p-[var(--space-8)]">
        <div className="relative text-center">
          {/* Brand mark (DESIGN.md §1) */}
          <div
            className="mb-[var(--space-4)] inline-block font-mono text-4xl leading-none tracking-wider"
            aria-label="VRX"
          >
            <span style={{ color: 'var(--vrc)' }}>V</span>
            <span style={{ color: 'var(--bridge)' }}>R</span>
            <span style={{ color: 'var(--cvr)' }}>X</span>
          </div>

          {/* Error glyph + heading (DESIGN.md R2/R10: color + non-color glyph) */}
          <p
            className="mb-[var(--space-2)] flex items-center justify-center gap-[var(--space-2)] text-sm font-semibold text-[var(--error)]"
            role="alert"
          >
            <span aria-hidden="true">⚠</span>
            {t('error.heading')}
          </p>

          <p className="mb-[var(--space-6)] text-xs text-[var(--text-faint)]">{t('error.hint')}</p>

          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
          >
            {t('error.reload')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface State {
  hasError: boolean
}

/**
 * React error boundary (VRX-127).
 *
 * Catches render-phase errors from its subtree and shows a glass-styled
 * fallback instead of a white screen. The componentDidCatch log goes to
 * electron-log/renderer, which forwards to the main process via the IPC
 * bridge that log.initialize() wires up in main (VRX-15). No new IPC
 * channels are needed.
 */
export default class ErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logRenderer.error('React render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack
    })
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback />
    }
    return this.props.children
  }
}
