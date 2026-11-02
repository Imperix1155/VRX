import { Component, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type FallbackVariant = 'app' | 'panel'

/** How long the button reads "Copied" after a copy worked. */
const COPIED_LABEL_MS = 2_000

/** Copied diagnostics leave out folder names: only file names stay (`index-….js:12:345`). */
function withoutInstallFolder(text: string): string {
  return text.replace(/file:\/\/\/[^\s)]*\//g, '')
}

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
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    }
  }, [])

  function copyDiagnostics(): void {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current)
    setCopy('idle')
    const text = withoutInstallFolder(
      `${error?.message ?? 'Unknown error'}\n\n${error?.stack ?? ''}`
    )
    const failed = (): void => {
      if (mounted.current) setCopy('failed')
    }
    let writing: Promise<void>
    try {
      writing = navigator.clipboard.writeText(text)
    } catch {
      failed()
      return
    }
    writing.then(() => {
      if (!mounted.current) return
      setCopy('copied')
      resetTimer.current = setTimeout(() => setCopy('idle'), COPIED_LABEL_MS)
    }, failed)
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
        className={`glass glass-information relative w-full max-w-sm overflow-hidden ${
          isPanel ? 'p-[var(--space-6)]' : 'p-[var(--space-8)]'
        }`}
      >
        <div className="relative text-center">
          {/* Brand mark (DESIGN.md §1) — full-screen app crash only, not per-panel. */}
          {!isPanel && (
            <div
              className="mb-[var(--space-4)] inline-block font-mono text-4xl leading-none tracking-wider"
              role="img"
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

          <p className="mb-[var(--space-6)] text-xs text-[var(--text-dim)]">{t('error.hint')}</p>

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
              className="rounded-control border border-[var(--border)] bg-[var(--control-fill)] px-[var(--space-4)] py-[var(--space-2)] text-xs text-[var(--text-dim)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
            >
              {t(copy === 'copied' ? 'error.copied' : 'error.copyDiagnostics')}
            </button>
            {/* Screen readers hear the result; a failure also shows under the button. */}
            <p
              role="status"
              className={copy === 'failed' ? 'text-xs text-[var(--text-dim)]' : 'sr-only'}
            >
              {copy === 'idle' ? '' : t(copy === 'copied' ? 'error.copied' : 'error.copyFailed')}
            </p>
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
