/**
 * Settings → Accounts → Back up automatically (owner, 2026-11-25). Off until
 * the user turns it on. Main owns the folder and the copies; this card only
 * starts a choice or a restore and says what happened. A cancelled folder
 * dialog says nothing.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AUTO_BACKUP_INTERVALS,
  AUTO_BACKUP_KEEP_MAX,
  AUTO_BACKUP_KEEP_MIN,
  type AutoBackupInterval,
  type AutoBackupProblem,
  type AutoBackupRestoreResult,
  type AutoBackupStatus
} from '@shared/autoBackup'
import { useSettingsStore } from '../stores/settings'
import LinkedDialog from './LinkedDialog'
import NumberStepper from './NumberStepper'
import SegmentedControl from './SegmentedControl'
import Toggle from './Toggle'

const INTERVAL_LABEL_KEYS = {
  daily: 'settings.autoBackup.interval.daily',
  '3d': 'settings.autoBackup.interval.3d',
  weekly: 'settings.autoBackup.interval.weekly'
} as const satisfies Record<AutoBackupInterval, string>

const ERROR_KEYS = {
  failed: 'settings.autoBackup.error.failed',
  folder: 'settings.autoBackup.error.folder',
  integrity: 'settings.autoBackup.error.integrity'
} as const satisfies Record<AutoBackupProblem, string>

const RESTORE_FAILURE_KEYS = {
  off: 'settings.autoBackup.restoreOff',
  unknown: 'settings.autoBackup.unknown',
  'not-a-backup': 'settings.autoBackup.restoreNotBackup',
  newer: 'settings.autoBackup.restoreNewer',
  failed: 'settings.autoBackup.restoreFailed',
  'rate-limited': 'settings.autoBackup.tooMany'
} as const satisfies Record<Extract<AutoBackupRestoreResult, { ok: false }>['reason'], string>

const buttonClass = [
  'inline-flex items-center gap-[var(--space-1)] whitespace-nowrap',
  'px-[var(--space-3)] py-[var(--space-1)] rounded-[10px] text-[13px] font-medium',
  'border border-[var(--border)]',
  'bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)]',
  'text-[var(--text)]',
  'focus:outline-none focus:ring-1 focus:ring-[var(--text-dim)]',
  'cursor-pointer aria-disabled:cursor-default aria-disabled:opacity-60'
].join(' ')

function formatWhen(at: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

/** B, KB, or MB. One decimal while the number is under 10, except for bytes. */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB'] as const
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1)
  return `${shown} ${units[unit]}`
}

export default function AutoBackupCard(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const enabled = useSettingsStore((s) => s.settings.autoBackup)
  const interval = useSettingsStore((s) => s.settings.autoBackupInterval)
  const keep = useSettingsStore((s) => s.settings.autoBackupKeep)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const [status, setStatus] = useState<AutoBackupStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [askingId, setAskingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const running = useRef(false)

  const load = (): void => {
    const reading = window.vrx?.getAutoBackup?.()
    if (!reading) return
    void reading.then(
      (next) => {
        if (mounted.current) setStatus(next)
      },
      () => undefined
    )
  }

  useEffect(() => {
    mounted.current = true
    load()
    const unsubscribe = window.vrx?.onAutoBackupChanged?.(() => load())
    return () => {
      mounted.current = false
      unsubscribe?.()
    }
  }, [])

  const finish = (apply: () => void): void => {
    running.current = false
    if (!mounted.current) return
    setBusy(false)
    apply()
    load()
  }

  const changeFolder = (): void => {
    if (running.current) return
    const choosing = window.vrx?.chooseAutoBackupFolder?.()
    if (!choosing) {
      setNotice(t('settings.autoBackup.error.folder'))
      return
    }
    running.current = true
    setBusy(true)
    void choosing.then(
      (result) =>
        finish(() => {
          if (!result.ok && result.reason === 'cancelled') return
          if (!result.ok && result.reason === 'failed')
            setNotice(t('settings.autoBackup.error.folder'))
          if (!result.ok && result.reason === 'rate-limited')
            setNotice(t('settings.autoBackup.tooMany'))
          if (result.ok) setNotice('')
        }),
      () => finish(() => setNotice(t('settings.autoBackup.error.folder')))
    )
  }

  const resetFolder = (): void => {
    if (running.current) return
    const resetting = window.vrx?.resetAutoBackupFolder?.()
    if (!resetting) return
    running.current = true
    setBusy(true)
    void resetting.then(
      (result) =>
        finish(() => {
          if (result.ok) setNotice('')
          else if (result.reason === 'rate-limited') setNotice(t('settings.autoBackup.tooMany'))
          else setNotice(t('settings.autoBackup.error.folder'))
        }),
      () => finish(() => setNotice(t('settings.autoBackup.tooMany')))
    )
  }

  const confirmRestore = (id: string): void => {
    if (running.current) return
    const restoring = window.vrx?.restoreAutoBackup?.({ id })
    if (!restoring) {
      setRestoreMessage(t('settings.autoBackup.restoreFailed'))
      return
    }
    running.current = true
    setBusy(true)
    setAskingId(null)
    setRestoreMessage('')
    void restoring.then(
      (result) =>
        finish(() => {
          setRestoreMessage(
            result.ok ? t('settings.autoBackup.restored') : t(RESTORE_FAILURE_KEYS[result.reason])
          )
        }),
      () => finish(() => setRestoreMessage(t('settings.autoBackup.restoreFailed')))
    )
  }

  const errorText =
    notice !== '' ? notice : status?.lastError ? t(ERROR_KEYS[status.lastError]) : ''
  const folderText =
    status === null || status.usingDefaultFolder
      ? t('settings.autoBackup.folder.default')
      : status.folderName

  return (
    <div className="setting-card" data-auto-backup="">
      <div className="setting-row">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">{t('settings.autoBackup.label')}</p>
          <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
            {t('settings.autoBackup.description')}
          </p>
          <p className="mt-[var(--space-0-5)] text-xs text-[var(--text-dim)]">
            {status?.lastBackupAt != null
              ? t('settings.autoBackup.last', {
                  time: formatWhen(status.lastBackupAt, i18n.language)
                })
              : t('settings.autoBackup.none')}
          </p>
          <p
            role="status"
            data-auto-backup-error={status?.lastError ?? ''}
            className="mt-[var(--space-0-5)] text-xs text-[var(--error)] empty:hidden"
          >
            {errorText}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setRestoreMessage('')
              setAskingId(null)
              setOpen(true)
            }}
          >
            {t('settings.autoBackup.restoreButton')}
          </button>
          <Toggle
            checked={enabled}
            ariaLabel={t('settings.autoBackup.aria')}
            onChange={(checked) => updateSettings({ autoBackup: checked })}
          />
        </div>
      </div>
      <div
        className="setting-disclosure"
        data-expanded={enabled}
        inert={!enabled}
        aria-hidden={!enabled}
      >
        <div className="setting-disclosure-clip">
          <div className="setting-children">
            <div className="setting-row">
              <p className="text-sm font-medium text-[var(--text)]">
                {t('settings.autoBackup.interval.label')}
              </p>
              <SegmentedControl
                values={AUTO_BACKUP_INTERVALS}
                active={interval}
                labelKeys={INTERVAL_LABEL_KEYS}
                ariaLabel={t('settings.autoBackup.interval.aria')}
                onChange={(value) => updateSettings({ autoBackupInterval: value })}
              />
            </div>
            <div className="setting-row">
              <p className="text-sm font-medium text-[var(--text)]">
                {t('settings.autoBackup.keep.label')}
              </p>
              <NumberStepper
                value={keep}
                min={AUTO_BACKUP_KEEP_MIN}
                max={AUTO_BACKUP_KEEP_MAX}
                ariaLabel={t('settings.autoBackup.keep.aria')}
                onChange={(next) => updateSettings({ autoBackupKeep: next })}
              />
            </div>
            <div className="setting-row">
              <div>
                <p className="text-sm font-medium text-[var(--text)]">
                  {t('settings.autoBackup.folder.label')}
                </p>
                <p className="mt-[var(--space-0-5)] text-xs text-[var(--text)]">{folderText}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
                <button
                  type="button"
                  className={buttonClass}
                  aria-disabled={busy}
                  onClick={changeFolder}
                >
                  {t('settings.autoBackup.folder.change')}
                </button>
                {status !== null && !status.usingDefaultFolder ? (
                  <button
                    type="button"
                    className={buttonClass}
                    aria-disabled={busy}
                    onClick={resetFolder}
                  >
                    {t('settings.autoBackup.folder.useDefault')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {open ? (
        <LinkedDialog
          title={t('settings.autoBackup.label')}
          busy={busy}
          onClose={() => {
            if (busy) return
            setOpen(false)
            setAskingId(null)
          }}
        >
          {status === null || status.copies.length === 0 ? (
            <p className="text-xs text-[var(--text-dim)]">{t('settings.autoBackup.list.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-[var(--space-2)]">
              {status.copies.map((copy) => (
                <li
                  key={copy.id}
                  className="flex flex-wrap items-center justify-between gap-[var(--space-2)]"
                >
                  {askingId === copy.id ? (
                    <div>
                      <p className="text-xs text-[var(--text)]">
                        {t('settings.autoBackup.list.ask')}
                      </p>
                      <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => setAskingId(null)}
                        >
                          {t('settings.autoBackup.list.cancel')}
                        </button>
                        <button
                          type="button"
                          className={`${buttonClass} font-semibold`}
                          onClick={() => confirmRestore(copy.id)}
                        >
                          {t('settings.autoBackup.list.confirm')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-xs text-[var(--text)]">
                        {formatWhen(copy.createdAt, i18n.language)}
                        {' · '}
                        {formatBytes(copy.bytes)}
                      </span>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-disabled={busy}
                        onClick={() => {
                          if (busy) return
                          setRestoreMessage('')
                          setAskingId(copy.id)
                        }}
                      >
                        {t('settings.autoBackup.list.restore')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p role="status" className="mt-[var(--space-2)] text-xs text-[var(--text)] empty:hidden">
            {restoreMessage}
          </p>
        </LinkedDialog>
      ) : null}
    </div>
  )
}
