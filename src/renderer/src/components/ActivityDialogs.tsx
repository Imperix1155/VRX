/**
 * The Activity page's two dialogs (owner, 2026-11-15): how long activity
 * stays saved on this computer (with the buttons that move saved history:
 * `HistoryTransfer.tsx`), and the question before Clear deletes saved
 * activity. Both use the shared dialog shell.
 */
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACTIVITY_KEEP_FOR, type ActivityKeepFor } from '@shared/activity'
import { ACTIVITY_KEEP_LABEL_KEYS } from '../utils/activityText'
import HistoryTransfer from './HistoryTransfer'
import LinkedDialog from './LinkedDialog'

const buttonClass =
  'rounded-control border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)] motion-safe:transition-colors'

/**
 * Pick how long activity is kept. A longer choice applies at once, like every
 * setting. A shorter one deletes saved history for good, so it asks first:
 * the radio shows the pick, nothing is deleted, and the setting changes only
 * on "Switch and delete". Without that question one arrow key on the radio
 * group would wipe saved history. Closing the dialog drops an unanswered pick.
 */
export function ActivityKeepDialog({
  value,
  onChange,
  onRestored,
  onClose
}: {
  value: ActivityKeepFor
  onChange: (value: ActivityKeepFor) => void
  /** A restore replaced the saved history under the page. */
  onRestored: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const noteId = useId()
  const groupId = useId()
  const [asking, setAsking] = useState<ActivityKeepFor | null>(null)
  const shown = asking ?? value
  const pick = (option: ActivityKeepFor): void => {
    if (deletesSavedHistory(value, option)) {
      setAsking(option)
      return
    }
    setAsking(null)
    if (option !== value) onChange(option)
  }
  return (
    <LinkedDialog title={t('activity.keep.title')} onClose={onClose}>
      <p id={noteId} className="text-[13px] text-[var(--text-dim)]">
        {t('activity.keep.note')}
      </p>
      <div
        role="radiogroup"
        aria-label={t('activity.keep.title')}
        aria-describedby={noteId}
        className="mt-[var(--space-3)] flex flex-col gap-[var(--space-1)]"
      >
        {ACTIVITY_KEEP_FOR.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-[var(--space-3)] rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--text-dim)]"
          >
            <input
              type="radio"
              name={groupId}
              value={option}
              checked={shown === option}
              onChange={() => pick(option)}
              className="h-[14px] w-[14px] shrink-0 accent-[var(--text)] focus:outline-none"
            />
            <span>{t(ACTIVITY_KEEP_LABEL_KEYS[option])}</span>
          </label>
        ))}
      </div>
      {asking === null ? (
        <HistoryTransfer saving={value !== 'session'} onRestored={onRestored} />
      ) : (
        <div
          data-keep-ask=""
          aria-live="polite"
          className="mt-[var(--space-3)] border-t border-[var(--border)] pt-[var(--space-3)]"
        >
          <p className="text-[12px] text-[var(--text)]">
            {asking === 'session'
              ? t('activity.keep.askSession')
              : t('activity.keep.askShorter', { choice: t(ACTIVITY_KEEP_LABEL_KEYS[asking]) })}
          </p>
          <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
            <button type="button" className={buttonClass} onClick={() => setAsking(null)}>
              {t('activity.keep.askCancel')}
            </button>
            <button
              type="button"
              className={`${buttonClass} font-semibold`}
              onClick={() => {
                setAsking(null)
                onChange(asking)
              }}
            >
              {t('activity.keep.askConfirm')}
            </button>
          </div>
        </div>
      )}
      <div className="mt-[var(--space-4)] flex justify-end">
        <button type="button" className={buttonClass} onClick={onClose}>
          {t('activity.keep.done')}
        </button>
      </div>
    </LinkedDialog>
  )
}

/** Whether moving from `current` to `next` deletes anything saved: the
 *  choices are listed shortest first, and "until VRX closes" saves nothing. */
export function deletesSavedHistory(current: ActivityKeepFor, next: ActivityKeepFor): boolean {
  return ACTIVITY_KEEP_FOR.indexOf(next) < ACTIVITY_KEEP_FOR.indexOf(current)
}

/** Asked before Clear when activity is saved: it deletes saved entries too. */
export function ActivityClearDialog({
  body,
  onConfirm,
  onClose
}: {
  /** What is deleted, when it is not the Activity list. */
  body?: string
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <LinkedDialog title={t('activity.clearConfirm.title')} onClose={onClose}>
      <p className="text-[13px] text-[var(--text-dim)]">
        {body ?? t('activity.clearConfirm.body')}
      </p>
      <div className="mt-[var(--space-4)] flex justify-end gap-[var(--space-2)]">
        <button type="button" className={buttonClass} onClick={onClose}>
          {t('activity.clearConfirm.cancel')}
        </button>
        <button
          type="button"
          className={`${buttonClass} font-semibold`}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {t('activity.clearConfirm.confirm')}
        </button>
      </div>
    </LinkedDialog>
  )
}
