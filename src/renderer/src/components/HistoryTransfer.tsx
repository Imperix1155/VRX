/**
 * Moving saved history (owner, 2026-11-15), inside the Activity page's Kept
 * dialog: bring VRCX's history in, save a backup, restore one. Main does the
 * work and owns the file dialogs; these buttons only start it and say what
 * happened. A cancelled dialog says nothing.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  HistoryBackupResult,
  HistoryRestoreResult,
  VrcxHistoryImportResult
} from '@shared/historyTransfer'

type Action = 'import' | 'backup' | 'restore'

const IMPORT_FAILURE_KEYS = {
  off: 'activity.transfer.off',
  'signed-out': 'activity.transfer.importSignedOut',
  busy: 'activity.transfer.importBusy',
  'not-found': 'activity.transfer.importNotFound',
  'no-history': 'activity.transfer.importNoHistory',
  failed: 'activity.transfer.importFailed',
  'rate-limited': 'activity.transfer.tooMany'
} as const satisfies Record<Extract<VrcxHistoryImportResult, { ok: false }>['reason'], string>

const BACKUP_FAILURE_KEYS = {
  off: 'activity.transfer.off',
  failed: 'activity.transfer.backupFailed',
  'rate-limited': 'activity.transfer.tooMany'
} as const satisfies Record<
  Exclude<Extract<HistoryBackupResult, { ok: false }>['reason'], 'cancelled'>,
  string
>

const RESTORE_FAILURE_KEYS = {
  off: 'activity.transfer.off',
  'not-a-backup': 'activity.transfer.restoreNotBackup',
  newer: 'activity.transfer.restoreNewer',
  failed: 'activity.transfer.restoreFailed',
  'rate-limited': 'activity.transfer.tooMany'
} as const satisfies Record<
  Exclude<Extract<HistoryRestoreResult, { ok: false }>['reason'], 'cancelled'>,
  string
>

const WORKING_KEYS = {
  import: 'activity.transfer.working.import',
  backup: 'activity.transfer.working.backup',
  restore: 'activity.transfer.working.restore'
} as const satisfies Record<Action, string>

const buttonClass =
  'rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-1)] text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors cursor-pointer aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent'

export default function HistoryTransfer({
  saving,
  onRestored
}: {
  /** False while activity is kept only until VRX closes: nothing to move. */
  saving: boolean
  /** A restore replaced everything saved: what a page still shows of the
   *  rows before it is no longer there. */
  onRestored?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<Action | null>(null)
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  const [outcome, setOutcome] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A ref, not the state: several presses can land before the next render.
  const running = useRef(false)

  const run = <T extends { ok: boolean }>(
    action: Action,
    start: (() => Promise<T>) | undefined,
    describe: (result: T) => string,
    failed: string
  ): void => {
    if (running.current || !saving) return
    setAsking(false)
    const started = start?.()
    if (!started) {
      setMessage(failed)
      setOutcome('failed')
      return
    }
    running.current = true
    setBusy(action)
    setMessage('')
    setOutcome('')
    void started
      .then(
        (result) => ({ text: describe(result), kind: result.ok ? 'done' : 'refused' }),
        () => ({ text: failed, kind: 'failed' })
      )
      .then((next) => {
        running.current = false
        if (!mounted.current) return
        setBusy(null)
        setMessage(next.text)
        setOutcome(next.text === '' ? '' : next.kind)
      })
  }

  const importVrcx = (): void =>
    run(
      'import',
      window.vrx?.importVrcxHistory,
      (result) => {
        if (!result.ok) return t(IMPORT_FAILURE_KEYS[result.reason])
        const { friendsSince, names, visits } = result
        const found =
          friendsSince + names + visits === 0
            ? t('activity.transfer.importedNothing')
            : t('activity.transfer.imported', { visits, friends: friendsSince, names })
        const lines = [found]
        if (result.olderSkipped) lines.push(t('activity.transfer.importedOlder'))
        if (result.otherAccountSkipped) lines.push(t('activity.transfer.importedOtherAccount'))
        return lines.join('\n')
      },
      t('activity.transfer.importFailed')
    )
  const backUp = (): void =>
    run(
      'backup',
      window.vrx?.backupHistory,
      (result) =>
        result.ok
          ? t('activity.transfer.backedUp')
          : result.reason === 'cancelled'
            ? ''
            : t(BACKUP_FAILURE_KEYS[result.reason]),
      t('activity.transfer.backupFailed')
    )
  const restore = (): void =>
    run(
      'restore',
      window.vrx?.restoreHistory,
      (result) => {
        if (result.ok) {
          onRestored?.()
          return t('activity.transfer.restored')
        }
        return result.reason === 'cancelled' ? '' : t(RESTORE_FAILURE_KEYS[result.reason])
      },
      t('activity.transfer.restoreFailed')
    )

  const disabled = !saving || busy !== null
  const status =
    busy !== null ? t(WORKING_KEYS[busy]) : !saving ? t('activity.transfer.off') : message

  return (
    <section
      data-history-transfer=""
      aria-label={t('activity.transfer.heading')}
      className="mt-[var(--space-3)] border-t border-[var(--border)] pt-[var(--space-3)]"
    >
      <h3 className="text-[12px] font-semibold text-[var(--text)]">
        {t('activity.transfer.heading')}
      </h3>
      <p className="mt-[var(--space-0-5)] text-[12px] text-[var(--text-dim)]">
        {t('activity.transfer.hint')}
      </p>
      {asking ? (
        <div className="mt-[var(--space-2)]" data-history-restore-ask="">
          <p className="text-[12px] text-[var(--text)]">{t('activity.transfer.restoreAsk')}</p>
          <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
            <button type="button" className={buttonClass} onClick={() => setAsking(false)}>
              {t('activity.transfer.cancel')}
            </button>
            <button type="button" className={`${buttonClass} font-semibold`} onClick={restore}>
              {t('activity.transfer.restoreConfirm')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
          <button
            type="button"
            className={buttonClass}
            aria-disabled={disabled}
            onClick={importVrcx}
          >
            {t('activity.transfer.importVrcx')}
          </button>
          <button type="button" className={buttonClass} aria-disabled={disabled} onClick={backUp}>
            {t('activity.transfer.backup')}
          </button>
          <button
            type="button"
            className={buttonClass}
            aria-disabled={disabled}
            onClick={() => {
              if (disabled) return
              setMessage('')
              setOutcome('')
              setAsking(true)
            }}
          >
            {t('activity.transfer.restore')}
          </button>
        </div>
      )}
      <p
        role="status"
        data-history-transfer-result={busy !== null ? 'working' : outcome}
        className="mt-[var(--space-2)] whitespace-pre-line text-[12px] text-[var(--text)] empty:hidden"
      >
        {status}
      </p>
    </section>
  )
}
