import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OWN_BIO_MAX_LENGTH,
  OWN_PRONOUNS_MAX_LENGTH,
  OWN_STATUSES,
  OWN_STATUS_TEXT_MAX_LENGTH,
  type OwnProfile,
  type OwnProfileChanges,
  type OwnStatus,
  type SaveOwnProfileResult
} from '@shared/ownProfile'
import type { Platform } from '@shared/types'
import { saveOwnProfile, useOwnProfile } from '../queries/ownProfile'
import { ACCOUNT_CARD_CONFIG } from '../utils/accountCard'
import { AUTH_INPUT_CLASS } from './auth/AuthInput'
import LinkedDialog from './LinkedDialog'

/** The same dot and word the friends list and drawer use for each status. */
const STATUS_LOOK: Record<OwnStatus, { colorVar: string; labelKey: string }> = {
  'join-me': { colorVar: '--st-joinme', labelKey: 'friends.status.joinMe' },
  online: { colorVar: '--st-online', labelKey: 'friends.status.online' },
  'ask-me': { colorVar: '--st-askme', labelKey: 'friends.status.askMe' },
  dnd: { colorVar: '--st-dnd', labelKey: 'friends.status.dnd' }
}

type SaveFailure = Exclude<SaveOwnProfileResult, { ok: true }>['reason']

const FAILURE_KEY: Record<SaveFailure, string> = {
  'not-authenticated': 'settings.accounts.profile.error.signedOut',
  'rate-limited': 'settings.accounts.profile.error.wait',
  cooldown: 'settings.accounts.profile.error.wait',
  invalid: 'settings.accounts.profile.error.invalid',
  unavailable: 'settings.accounts.profile.error.unavailable'
}

const NEUTRAL_BUTTON =
  'rounded-control border border-[var(--border)] px-[var(--space-4)] py-[var(--space-2)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:opacity-50 motion-safe:transition-colors'

interface Draft {
  bio: string
  pronouns: string
  status: OwnStatus | null
  statusText: string
}

/** Only the fields that differ from what the platform holds now. */
function changesFrom(draft: Draft, profile: OwnProfile): OwnProfileChanges {
  const changes: OwnProfileChanges = {}
  if (draft.bio !== profile.bio) changes.bio = draft.bio
  if (draft.pronouns !== profile.pronouns) changes.pronouns = draft.pronouns
  if (profile.platform === 'vrchat') {
    if (draft.status !== null && draft.status !== profile.status) changes.status = draft.status
    if (draft.statusText !== (profile.statusText ?? '')) changes.statusText = draft.statusText
  }
  return changes
}

/** A field's label with its character count on the same line. */
function FieldLabel({
  htmlFor,
  counterId,
  label,
  current,
  max
}: {
  htmlFor: string
  counterId: string
  label: string
  current: number
  max: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const over = current > max
  return (
    <div className="mb-[var(--space-1)] flex items-baseline justify-between gap-[var(--space-3)]">
      <label htmlFor={htmlFor} className="text-xs text-[var(--text-dim)]">
        {label}
      </label>
      {/* Described by its field, not live: a live counter would speak on every keystroke. */}
      <span
        id={counterId}
        className={`text-[11px] tabular-nums ${over ? 'font-semibold text-[var(--error)]' : 'text-[var(--text-dim)]'}`}
      >
        {over ? '! ' : ''}
        {t('settings.accounts.profile.counter', { current, max })}
      </span>
    </div>
  )
}

function StatusPicker({
  value,
  disabled,
  onChange
}: {
  value: OwnStatus | null
  disabled: boolean
  onChange: (status: OwnStatus) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const nameId = useId()
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-[var(--space-1)] block text-xs text-[var(--text-dim)]">
        {t('settings.accounts.profile.status')}
      </legend>
      <div className="grid grid-cols-2 gap-[var(--space-2)]">
        {OWN_STATUSES.map((status) => {
          const look = STATUS_LOOK[status]
          return (
            <label key={status} className="min-w-0 cursor-pointer">
              <input
                type="radio"
                name={nameId}
                value={status}
                checked={value === status}
                onChange={() => onChange(status)}
                className="peer sr-only"
              />
              {/* The word is the status; the dot is the same hue the friends list uses. */}
              <span className="flex min-w-0 items-center gap-[var(--space-2)] rounded-control border border-[var(--border)] px-[var(--space-3)] py-[6px] text-[13px] text-[var(--text-dim)] hover:bg-[var(--surface-hover)] peer-checked:border-[var(--text-dim)] peer-checked:bg-[var(--surface-hover)] peer-checked:font-semibold peer-checked:text-[var(--text)] peer-focus-visible:ring-1 peer-focus-visible:ring-[var(--text-dim)] peer-disabled:opacity-50 motion-safe:transition-colors">
                <span
                  aria-hidden="true"
                  className="h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ background: `var(${look.colorVar})` }}
                />
                <span className="min-w-0 truncate">{t(look.labelKey)}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function ProfileForm({
  profile,
  saving,
  onSaving,
  onCancel,
  onSaved
}: {
  profile: OwnProfile
  saving: boolean
  onSaving: (saving: boolean) => void
  onCancel: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const platform = profile.platform
  const config = ACCOUNT_CARD_CONFIG[platform]
  const fieldId = useId()
  const [draft, setDraft] = useState<Draft>({
    bio: profile.bio,
    pronouns: profile.pronouns,
    status: profile.status,
    statusText: profile.statusText ?? ''
  })
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const changes = changesFrom(draft, profile)
  const tooLong =
    draft.bio.length > OWN_BIO_MAX_LENGTH ||
    draft.pronouns.length > OWN_PRONOUNS_MAX_LENGTH ||
    draft.statusText.length > OWN_STATUS_TEXT_MAX_LENGTH
  const canSave = !saving && !tooLong && Object.keys(changes).length > 0

  const update = (patch: Partial<Draft>): void => {
    setFailure(null)
    setDraft((current) => ({ ...current, ...patch }))
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSave) return
    setFailure(null)
    onSaving(true)
    const result = await saveOwnProfile(platform, changes)
    onSaving(false)
    if (result.ok) onSaved()
    else setFailure(result.reason)
  }

  const inputClass = `${AUTH_INPUT_CLASS} ${config.focusClass}`
  return (
    <form
      noValidate
      onSubmit={(event) => void handleSave(event)}
      className="flex flex-col gap-[var(--space-3)]"
    >
      <p className="text-[12.5px] text-[var(--text-dim)]">
        {t('settings.accounts.profile.intro', { platform: t(config.labelKey) })}
      </p>

      <div>
        <FieldLabel
          htmlFor={`${fieldId}-bio`}
          counterId={`${fieldId}-bio-counter`}
          label={t('settings.accounts.profile.bio')}
          current={draft.bio.length}
          max={OWN_BIO_MAX_LENGTH}
        />
        <textarea
          id={`${fieldId}-bio`}
          value={draft.bio}
          disabled={saving}
          onChange={(event) => update({ bio: event.target.value })}
          maxLength={Math.max(OWN_BIO_MAX_LENGTH, profile.bio.length)}
          rows={4}
          placeholder={t('settings.accounts.profile.bioPlaceholder')}
          aria-describedby={`${fieldId}-bio-counter`}
          className={`${inputClass} block resize-none`}
        />
      </div>

      <div>
        <FieldLabel
          htmlFor={`${fieldId}-pronouns`}
          counterId={`${fieldId}-pronouns-counter`}
          label={t('settings.accounts.profile.pronouns')}
          current={draft.pronouns.length}
          max={OWN_PRONOUNS_MAX_LENGTH}
        />
        <input
          id={`${fieldId}-pronouns`}
          type="text"
          value={draft.pronouns}
          disabled={saving}
          onChange={(event) => update({ pronouns: event.target.value })}
          maxLength={Math.max(OWN_PRONOUNS_MAX_LENGTH, profile.pronouns.length)}
          placeholder={t('settings.accounts.profile.pronounsPlaceholder')}
          aria-describedby={`${fieldId}-pronouns-counter`}
          autoComplete="off"
          className={inputClass}
        />
      </div>

      {/* VRChat only: ChilloutVR has no status to set (a real platform
          difference, so nothing stands in for it there). */}
      {platform === 'vrchat' && (
        <>
          <StatusPicker
            value={draft.status}
            disabled={saving}
            onChange={(status) => update({ status })}
          />
          <div>
            <FieldLabel
              htmlFor={`${fieldId}-status-text`}
              counterId={`${fieldId}-status-text-counter`}
              label={t('settings.accounts.profile.statusText')}
              current={draft.statusText.length}
              max={OWN_STATUS_TEXT_MAX_LENGTH}
            />
            <input
              id={`${fieldId}-status-text`}
              type="text"
              value={draft.statusText}
              disabled={saving}
              onChange={(event) => update({ statusText: event.target.value })}
              maxLength={Math.max(OWN_STATUS_TEXT_MAX_LENGTH, (profile.statusText ?? '').length)}
              placeholder={t('settings.accounts.profile.statusTextPlaceholder')}
              aria-describedby={`${fieldId}-status-text-counter`}
              autoComplete="off"
              className={inputClass}
            />
          </div>
        </>
      )}

      {/* The result sits beside the buttons, so a Save never moves them. */}
      <div className="mt-[var(--space-1)] flex items-center justify-between gap-[var(--space-3)]">
        <p role="status" className="min-w-0 flex-1 text-[12px] text-[var(--text-dim)]">
          {failure !== null ? (
            <>
              <span aria-hidden="true" className="font-bold text-[var(--error)]">
                !{' '}
              </span>
              {t(FAILURE_KEY[failure], { platform: t(config.labelKey) })}
            </>
          ) : saving ? (
            t('settings.accounts.profile.saving')
          ) : null}
        </p>
        <div className="flex shrink-0 gap-[var(--space-3)]">
          <button type="button" onClick={onCancel} disabled={saving} className={NEUTRAL_BUTTON}>
            {t('settings.accounts.profile.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className={`rounded-control border px-[var(--space-4)] py-[var(--space-2)] text-sm font-semibold hover:opacity-90 disabled:opacity-50 motion-safe:transition-opacity ${config.actionClass}`}
          >
            {t('settings.accounts.profile.save')}
          </button>
        </div>
      </div>
    </form>
  )
}

/**
 * Edit the signed-in user's own profile on one platform: the bio and
 * pronouns on both, and VRChat's status and status text. Reads when it opens
 * and writes only the changed fields when the user presses Save.
 */
export default function OwnProfileDialog({
  platform,
  onClose,
  onSaved
}: {
  platform: Platform
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const query = useOwnProfile(platform)
  const [saving, setSaving] = useState(false)
  const label = t(ACCOUNT_CARD_CONFIG[platform].labelKey)
  const result = query.data

  return (
    <LinkedDialog
      title={t('settings.accounts.profile.title', { platform: label })}
      busy={saving}
      onClose={onClose}
    >
      {result?.ok ? (
        <ProfileForm
          profile={result.profile}
          saving={saving}
          onSaving={setSaving}
          onCancel={onClose}
          onSaved={onSaved}
        />
      ) : query.isPending || query.isFetching ? (
        <p role="status" className="py-[var(--space-4)] text-sm text-[var(--text-dim)]">
          {t('settings.accounts.profile.loading')}
        </p>
      ) : (
        <div className="flex flex-col gap-[var(--space-3)] py-[var(--space-2)]">
          <p role="alert" className="text-sm text-[var(--text-dim)]">
            <span aria-hidden="true" className="font-bold text-[var(--error)]">
              !{' '}
            </span>
            {t(
              result?.ok === false && result.reason === 'not-authenticated'
                ? 'settings.accounts.profile.error.signedOut'
                : result?.ok === false && result.reason === 'rate-limited'
                  ? 'settings.accounts.profile.error.wait'
                  : 'settings.accounts.profile.error.load',
              { platform: label }
            )}
          </p>
          <div className="flex justify-end gap-[var(--space-3)]">
            <button type="button" onClick={onClose} className={NEUTRAL_BUTTON}>
              {t('settings.accounts.profile.cancel')}
            </button>
            <button type="button" onClick={() => void query.refetch()} className={NEUTRAL_BUTTON}>
              {t('settings.accounts.retry')}
            </button>
          </div>
        </div>
      )}
    </LinkedDialog>
  )
}
