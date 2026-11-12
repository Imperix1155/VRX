import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const EXPORT_FAILURE_KEYS = {
  'signed-out': 'settings.export.signedOut',
  'not-ready': 'settings.export.notReady',
  stale: 'settings.export.accountChanged',
  'save-failed': 'settings.export.failed',
  'rate-limited': 'settings.export.tooMany'
} as const

type ExportOutcome =
  | { kind: 'saved'; friends: number; notes: number; favorites: number; noGameFavorites: boolean }
  | { kind: keyof typeof EXPORT_FAILURE_KEYS }

/**
 * Export friends, notes and favorites to a file (owner, 2026-11-11). Main
 * builds the file and owns the save dialog; this row only starts it and says
 * what happened. A cancelled dialog says nothing.
 */
export default function ExportDataRow(): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A ref, not the state: several presses can land before the next render.
  const running = useRef(false)
  const exportData = (): void => {
    if (running.current) return
    const exporting = window.vrx?.exportData?.()
    if (!exporting) {
      setOutcome({ kind: 'save-failed' })
      return
    }
    running.current = true
    setBusy(true)
    setOutcome(null)
    void exporting
      .then(
        (result): ExportOutcome | null => {
          if (result.ok) {
            const { friends, notes, favorites } = result
            return {
              kind: 'saved',
              friends,
              notes,
              favorites,
              noGameFavorites: result.gameFavoritesMissing === true
            }
          }
          return result.reason === 'cancelled' ? null : { kind: result.reason }
        },
        (): ExportOutcome => ({ kind: 'save-failed' })
      )
      .then((next) => {
        running.current = false
        if (!mounted.current) return
        setBusy(false)
        setOutcome(next)
      })
  }
  const message =
    outcome === null
      ? ''
      : outcome.kind === 'saved'
        ? [
            t('settings.export.saved', {
              friends: outcome.friends,
              notes: outcome.notes,
              favorites: outcome.favorites
            }),
            ...(outcome.noGameFavorites ? [t('settings.export.noGameFavorites')] : [])
          ].join(' ')
        : t(EXPORT_FAILURE_KEYS[outcome.kind])
  return (
    <div className="setting-card setting-row" data-export-data="">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{t('settings.export.label')}</p>
        <p className="text-xs text-[var(--text-dim)] mt-[var(--space-0-5)]">
          {t('settings.export.description')}
        </p>
        <p
          role="status"
          data-export-result={outcome?.kind ?? ''}
          className="mt-[var(--space-0-5)] text-xs text-[var(--text)] empty:hidden"
        >
          {message}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        <button
          type="button"
          onClick={exportData}
          aria-disabled={busy}
          className={[
            'inline-flex items-center gap-[var(--space-1)] whitespace-nowrap',
            'px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
            'border border-[var(--border)]',
            'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
            'text-[var(--text)]',
            'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
            'cursor-pointer aria-disabled:cursor-default aria-disabled:opacity-60'
          ].join(' ')}
        >
          {t('settings.export.button')}
        </button>
      </div>
    </div>
  )
}
