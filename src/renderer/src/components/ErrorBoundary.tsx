import { Component } from 'react'
import { useTranslation } from 'react-i18next'

type FallbackVariant = 'app' | 'panel'

interface FallbackProps {
  error?: Error
  /** 'app' = full-screen (top-level crash); 'panel' = compact, fits inside a panel. */
  variant?: FallbackVariant
}

// Fallback UI is a functional component so it can call useTranslation
// (hooks cannot be called inside class components).
function ErrorFallback({ error, variant = 'app' }: FallbackProps): React.JSX.Element {
  const { t } = useTranslation()
  const isPanel = variant === 'panel'

  function copyDiagnostics(): void {
    const text = `${error?.message ?? 'Unknown error'}\n\n${error?.stack ?? ''}`
    navigator.clipboard.writeText(text).catch(() => undefined)
  }

  return (
    <div
      className={
        isPanel
          ? 'flex items-center justify-center px-[var(--space-4)] py-[var(--space-6)]'
          : 'flex min-h-screen items-center justify-center px-[var(--space-4)] py-[var(--space-10)]'
      }
    >
      <div
        className={`glass relative w-full max-w-sm overflow-hidden ${
          isPanel ? 'p-[var(--space-6)]' : 'p-[var(--space-8)]'
        }`}
      >
        <div className="relative text-center">
          {/* Brand mark (DESIGN.md §1) — full-screen app crash only, not per-panel. */}
          {!isPanel && (
            <div
              className="mb-[var(--space-4)] inline-block font-mono text-4xl leading-none tracking-wider"
              aria-label="VRX"
            >
              <span style={{ color: 'var(--vrc)' }}>V</span>
              <span style={{ color: 'var(--bridge)' }}>R</span>
              <span style={{ color: 'var(--cvr)' }}>X</span>
            </div>
          )}

          {/* Error glyph + heading (DESIGN.md R2/R10: color + non-color glyph) */}
          <p
            className="mb-[var(--space-2)] flex items-center justify-center gap-[var(--space-2)] text-sm font-semibold text-[var(--error)]"
            role="alert"
          >
            <span aria-hidden="true">⚠</span>
            {t('error.heading')}
          </p>

          <p className="mb-[var(--space-6)] text-xs text-[var(--text-faint)]">{t('error.hint')}</p>

          <div className="flex flex-col gap-[var(--space-2)]">
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
            >
              {t('error.reload')}
            </button>
            <button
              type="button"
              onClick={copyDiagnostics}
              className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-xs text-[var(--text-faint)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
            >
              {t('error.copyDiagnostics')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * React error boundary (VRX-127).
 *
 * Catches render-phase errors from its subtree and shows a glass-styled
 * fallback instead of a white screen. Diagnostics stay renderer-local for
 * explicit copy; the main logger deliberately exposes no renderer IPC.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Forwarded to the fallback — 'panel' renders a compact, non-full-screen fallback. */
  variant?: FallbackVariant
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} variant={this.props.variant} />
    }
    return this.props.children
  }
}
