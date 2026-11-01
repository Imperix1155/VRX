/**
 * AccountNoteStatus: one quiet line under a friend's note that says whether it
 * is also on the user's VRChat or ChilloutVR account, and, when the account
 * copy and VRX's copy both changed, a small choice between them. The line is
 * text with a glyph, never color alone. Nothing shows while the account is
 * being checked, so opening a drawer does not flicker.
 */
import { useTranslation } from 'react-i18next'
import { VRCHAT_ACCOUNT_NOTE_MAX_LENGTH } from '@shared/accountNotes'
import type { Platform } from '@shared/types'
import type { UseAccountNoteResult } from '../hooks/useAccountNote'
import { platformName } from '../utils/community'

const ACTION =
  'shrink-0 rounded-pill px-[var(--space-1)] font-semibold text-[var(--text)] hover:bg-[var(--surface-hover)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--text-dim)]'

export default function AccountNoteStatus({
  platform,
  account,
  hasNote,
  isEditing
}: {
  platform: Platform
  account: UseAccountNoteResult
  /** VRX's saved copy is not empty. */
  hasNote: boolean
  isEditing: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const name = platformName(t, platform)
  const { view } = account

  if (view.kind === 'conflict') {
    return (
      <div
        role="group"
        aria-labelledby="friend-notes-account-heading"
        className="flex flex-col gap-[var(--space-1)] rounded-control border px-[var(--space-2)] py-[var(--space-2)] text-[12px] text-[var(--text-dim)]"
        style={{ borderColor: 'var(--border)', background: 'var(--control-fill)' }}
      >
        <p id="friend-notes-account-heading" className="flex items-start gap-[var(--space-2)]">
          <span aria-hidden="true" className="font-bold text-[var(--text)]">
            ⇄
          </span>
          <span className="min-w-0 flex-1">
            {t('drawer.notes.account.conflict', { platform: name })}
          </span>
        </p>
        <blockquote
          className="line-clamp-3 border-l-2 pl-[var(--space-2)] break-words whitespace-pre-line text-[var(--text)]"
          style={{ borderColor: 'var(--border)' }}
        >
          {view.accountNote || t('drawer.notes.account.empty')}
        </blockquote>
        <div className="flex flex-wrap justify-end gap-[var(--space-1)]">
          <button type="button" onClick={account.useAccountCopy} className={ACTION}>
            {t('drawer.notes.account.useTheirs', { platform: name })}
          </button>
          <button type="button" onClick={account.keepMine} className={ACTION}>
            {t('drawer.notes.account.keepMine')}
          </button>
        </div>
      </div>
    )
  }

  // While typing, the line would describe the old text.
  if (isEditing) return null

  let glyph: string
  let text: string
  let action: { label: string; onClick: () => void } | null = null
  switch (view.kind) {
    case 'working':
      if (view.mode === 'check' || view.mode === 'use-account') return null
      glyph = '↻'
      text = t('drawer.notes.account.saving', { platform: name })
      break
    case 'saved':
      if (!hasNote) return null
      glyph = '✓'
      text = t('drawer.notes.account.saved', { platform: name })
      break
    case 'local-only':
      glyph = '•'
      text = t('drawer.notes.account.localOnly')
      action = {
        label: t('drawer.notes.account.save', { platform: name }),
        onClick: account.saveNow
      }
      break
    case 'too-long':
      glyph = '•'
      text = t('drawer.notes.account.tooLong', {
        platform: name,
        max: VRCHAT_ACCOUNT_NOTE_MAX_LENGTH
      })
      break
    case 'failed':
      glyph = '!'
      text = t('drawer.notes.account.failed', { platform: name })
      action = { label: t('drawer.notes.retry'), onClick: account.retry }
      break
    default:
      return null
  }

  return (
    <p
      role="status"
      className="flex min-w-0 flex-1 items-baseline gap-[var(--space-1)] text-[11px] text-[var(--text-dim)]"
    >
      <span aria-hidden="true" className="shrink-0 font-bold">
        {glyph}
      </span>
      <span className="min-w-0">{text}</span>
      {action && (
        <button type="button" onClick={action.onClick} className={ACTION}>
          {action.label}
        </button>
      )}
    </p>
  )
}
