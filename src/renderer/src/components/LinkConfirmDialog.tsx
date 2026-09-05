import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FriendRef,
  LinkFailure,
  LinkRequest,
  LinkResult,
  LinkSnapshot,
  LinkedProfile
} from '@shared/linkedProfiles'
import type { Platform } from '@shared/types'

export type LinkReview =
  | {
      kind: 'replace'
      members: [FriendRef, FriendRef]
      preferredPlatform: Platform
      accountIds: Record<Platform, string>
      affected: LinkedProfile[]
    }
  | { kind: 'unlink'; profile: LinkedProfile }

export interface LinkConfirmDialogProps {
  review: LinkReview
  identities: Array<{ ref: FriendRef & { platformAccountId?: string }; name: string }>
  onSubmit: (change: LinkRequest) => Promise<LinkResult<LinkSnapshot>>
  onClose: () => void
  onBack: () => void
  onSuccess: (snapshot: LinkSnapshot) => void
}

const PLATFORM_LABEL_KEYS: Record<Platform, string> = {
  vrchat: 'linking.confirm.platform.vrchat',
  chilloutvr: 'linking.confirm.platform.chilloutvr'
}

const ERROR_KEYS: Record<LinkFailure, string> = {
  stale: 'linking.confirm.error.stale',
  storage: 'linking.confirm.error.storage',
  invalid: 'linking.confirm.error.invalid',
  unavailable: 'linking.confirm.error.unavailable',
  'rate-limited': 'linking.confirm.error.rateLimited'
}

type IdentityRef = FriendRef & { platformAccountId?: string }

function sameRef(left: FriendRef, right: FriendRef): boolean {
  return left.platform === right.platform && left.friendId === right.friendId
}

function sameIdentityRef(candidate: IdentityRef, reviewed: IdentityRef): boolean {
  if (!sameRef(candidate, reviewed)) return false
  return reviewed.platformAccountId === undefined
    ? candidate.platformAccountId === undefined
    : candidate.platformAccountId === reviewed.platformAccountId
}

function cloneProfile(profile: LinkedProfile): LinkedProfile {
  return {
    ...profile,
    members: [{ ...profile.members[0] }, { ...profile.members[1] }]
  }
}

function captureReview(review: LinkReview): LinkReview {
  if (review.kind === 'unlink') return { kind: 'unlink', profile: cloneProfile(review.profile) }
  return {
    kind: 'replace',
    members: [{ ...review.members[0] }, { ...review.members[1] }],
    preferredPlatform: review.preferredPlatform,
    accountIds: { ...review.accountIds },
    affected: review.affected.map(cloneProfile)
  }
}

function identityKey(ref: IdentityRef): string {
  return `${ref.platformAccountId ?? ''}:${ref.platform}:${ref.friendId}`
}

function captureIdentities(
  identities: LinkConfirmDialogProps['identities']
): LinkConfirmDialogProps['identities'] {
  return identities.map((identity) => ({ ref: { ...identity.ref }, name: identity.name }))
}

export default function LinkConfirmDialog({
  review,
  identities,
  onSubmit,
  onClose,
  onBack,
  onSuccess
}: LinkConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [captured] = useState(() => ({
    review: captureReview(review),
    identities: captureIdentities(identities)
  }))
  const [preferredPlatform, setPreferredPlatform] = useState(() =>
    captured.review.kind === 'replace'
      ? captured.review.preferredPlatform
      : captured.review.profile.preferredPlatform
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<LinkFailure | 'unknown' | null>(null)
  const [reviewExpired, setReviewExpired] = useState(false)
  const pendingRef = useRef(false)

  const nameFor = (ref: IdentityRef): string =>
    captured.identities.find((identity) => sameIdentityRef(identity.ref, ref))?.name ??
    t('linking.confirm.identityUnavailable')
  const requiresAcknowledgement =
    captured.review.kind === 'unlink' || captured.review.affected.length > 0

  const command = (): LinkRequest => {
    if (captured.review.kind === 'unlink') {
      return {
        kind: 'unlink',
        personId: captured.review.profile.id,
        expectedRevision: captured.review.profile.revision
      }
    }
    const preferred = captured.review.members.find(
      (member) => member.platform === preferredPlatform
    )
    return {
      kind: 'replace',
      members: captured.review.members,
      preferredPlatform,
      defaultName: nameFor(preferred ?? captured.review.members[0]),
      expectedPeople: captured.review.affected.map((profile) => ({
        id: profile.id,
        revision: profile.revision
      }))
    }
  }

  const submit = async (): Promise<void> => {
    if ((requiresAcknowledgement && !acknowledged) || pendingRef.current || reviewExpired) return
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    try {
      const result = await onSubmit(command())
      if (result.ok) {
        onSuccess(result.value)
        return
      }
      setFailure(result.reason)
      if (result.reason === 'stale') setReviewExpired(true)
    } catch {
      setFailure('unknown')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  const buttonClass =
    'rounded-pill border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[13px] font-semibold text-[var(--text)] disabled:cursor-default disabled:opacity-50'
  const warningClass =
    'rounded-control border p-[var(--space-3)] text-[13px] text-[var(--text-dim)]'
  const sharedNoteDisclosure = (profile: LinkedProfile): React.JSX.Element => (
    <details
      key={profile.id}
      className="rounded-control border border-[var(--border)] p-[var(--space-2)]"
    >
      <summary className="cursor-pointer text-[12px] text-[var(--text-dim)]">
        {t('linking.confirm.sharedNote.summary', {
          name: profile.customName ?? profile.defaultName
        })}
      </summary>
      <p className="mt-[var(--space-2)] whitespace-pre-wrap text-[13px] text-[var(--text)]">
        {profile.sharedNote || t('linking.confirm.sharedNote.empty')}
      </p>
    </details>
  )
  const failureMessage =
    failure === null ? null : (
      <p role="alert" className="text-[12px] text-[var(--error)]">
        {t(failure === 'unknown' ? 'linking.confirm.error.unknown' : ERROR_KEYS[failure])}
      </p>
    )

  if (captured.review.kind === 'unlink') {
    const unlink = captured.review.profile
    const firstName = nameFor(unlink.members[0])
    const secondName = nameFor(unlink.members[1])
    return (
      <form
        className="flex flex-col gap-[var(--space-4)]"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-[var(--space-2)]">
          <p className="text-[13px] text-[var(--text)]">
            {t('linking.confirm.replace.oldPair', { first: firstName, second: secondName })}
          </p>
        </div>

        <div
          className={warningClass}
          style={{
            borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
            background: 'color-mix(in srgb, var(--error) 10%, transparent)'
          }}
        >
          <p>{t('linking.confirm.unlink.warning')}</p>
          <p className="mt-[var(--space-2)]">{t('linking.confirm.unlink.accountNotes')}</p>
        </div>

        {sharedNoteDisclosure(unlink)}

        <label className="flex items-start gap-[var(--space-2)] text-[13px] text-[var(--text)]">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={pending || reviewExpired}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>{t('linking.confirm.unlink.acknowledge')}</span>
        </label>

        {failureMessage}

        <div className="flex justify-end gap-[var(--space-2)]">
          <button type="button" className={buttonClass} disabled={pending} onClick={onBack}>
            {t('linking.confirm.back')}
          </button>
          <button type="button" className={buttonClass} disabled={pending} onClick={onClose}>
            {t('linking.confirm.cancel')}
          </button>
          <button
            type="submit"
            className={buttonClass}
            disabled={!acknowledged || pending || reviewExpired}
          >
            {pending ? t('linking.confirm.pending') : t('linking.confirm.unlink.submit')}
          </button>
        </div>
      </form>
    )
  }

  const replacement = captured.review
  const selectedScoped = replacement.members.map((member) => ({
    ...member,
    platformAccountId: replacement.accountIds[member.platform]
  }))
  const unselected = Array.from(
    new Map(
      replacement.affected
        .flatMap((profile) => profile.members.map((member) => ({ ...member })))
        .filter((member) => !selectedScoped.some((selected) => sameIdentityRef(member, selected)))
        .map((member) => [identityKey(member), member])
    ).values()
  )
  const preferred = replacement.members.find((member) => member.platform === preferredPlatform)

  return (
    <form
      className="flex flex-col gap-[var(--space-4)]"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-[13px] text-[var(--text-dim)]">{t('linking.confirm.replace.question')}</p>

      {requiresAcknowledgement ? (
        <div
          className={warningClass}
          style={{
            borderColor: 'color-mix(in srgb, var(--error) 45%, transparent)',
            background: 'color-mix(in srgb, var(--error) 10%, transparent)'
          }}
        >
          <strong className="text-[var(--text)]">
            {t('linking.confirm.replace.warningTitle')}
          </strong>
          <ul className="mt-[var(--space-2)] list-disc space-y-[var(--space-2)] pl-[var(--space-4)]">
            {replacement.affected.map((profile) => (
              <li key={profile.id}>
                <span className="text-[var(--text)]">
                  {t('linking.confirm.replace.oldPair', {
                    first: nameFor(profile.members[0]),
                    second: nameFor(profile.members[1])
                  })}
                </span>
                <span className="block">{t('linking.confirm.replace.oldPairEffect')}</span>
              </li>
            ))}
          </ul>
          <p className="mt-[var(--space-2)]">{t('linking.confirm.replace.accountNotes')}</p>
          <p className="mt-[var(--space-2)]">{t('linking.confirm.replace.blankNote')}</p>
          <p className="mt-[var(--space-2)]">{t('linking.confirm.replace.saveWarning')}</p>
        </div>
      ) : (
        <div className={warningClass}>
          <p>{t('linking.confirm.replace.accountNotes')}</p>
          <p className="mt-[var(--space-2)]">{t('linking.confirm.replace.blankNote')}</p>
        </div>
      )}

      <div
        role="group"
        aria-label={t('linking.confirm.replace.newPairLabel')}
        className="rounded-control border border-[var(--border)] p-[var(--space-3)]"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
          {t('linking.confirm.replace.newPairLabel')}
        </p>
        <p className="mt-[var(--space-1)] text-[13px] text-[var(--text)]">
          <span>{nameFor(replacement.members[0])}</span>
          <span aria-hidden="true"> + </span>
          <span>{nameFor(replacement.members[1])}</span>
        </p>
      </div>

      {unselected.length > 0 && (
        <ul
          aria-label={t('linking.confirm.replace.unlinkedLabel')}
          className="list-disc space-y-[var(--space-1)] pl-[var(--space-4)] text-[13px] text-[var(--text-dim)]"
        >
          {unselected.map((identity) => (
            <li key={identityKey(identity)}>
              {t('linking.confirm.replace.unlinkedEffect', { name: nameFor(identity) })}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-[var(--space-2)]">
        {replacement.affected.map(sharedNoteDisclosure)}
      </div>

      <fieldset className="space-y-[var(--space-2)]" role="radiogroup">
        <legend className="text-[13px] font-semibold text-[var(--text)]">
          {t('linking.confirm.preferred.label')}
        </legend>
        <p className="text-[12px] text-[var(--text-dim)]">{t('linking.confirm.preferred.help')}</p>
        <div className="flex gap-[var(--space-2)]">
          {replacement.members.map((member) => (
            <label
              key={member.platform}
              className="flex items-center gap-[var(--space-1)] rounded-pill border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[13px] text-[var(--text)]"
            >
              <input
                type="radio"
                name="link-preferred-platform"
                value={member.platform}
                checked={preferredPlatform === member.platform}
                disabled={pending || reviewExpired}
                onChange={() => setPreferredPlatform(member.platform)}
              />
              {t(PLATFORM_LABEL_KEYS[member.platform])}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
          {t('linking.confirm.combinedName')}
        </p>
        <strong className="text-[14px] text-[var(--text)]">
          {nameFor(preferred ?? replacement.members[0])}
        </strong>
        <p className="mt-[var(--space-1)] text-[12px] text-[var(--text-dim)]">
          {t('linking.confirm.combinedHelp')}
        </p>
      </div>

      {requiresAcknowledgement && (
        <label className="flex items-start gap-[var(--space-2)] text-[13px] text-[var(--text)]">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={pending || reviewExpired}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>{t('linking.confirm.replace.acknowledge')}</span>
        </label>
      )}

      {failureMessage}

      <div className="flex justify-end gap-[var(--space-2)]">
        <button type="button" className={buttonClass} disabled={pending} onClick={onBack}>
          {t('linking.confirm.back')}
        </button>
        <button type="button" className={buttonClass} disabled={pending} onClick={onClose}>
          {t('linking.confirm.cancel')}
        </button>
        <button
          type="submit"
          className={buttonClass}
          disabled={(requiresAcknowledgement && !acknowledged) || pending || reviewExpired}
        >
          {pending
            ? t('linking.confirm.pending')
            : t(
                requiresAcknowledgement
                  ? 'linking.confirm.replace.submit'
                  : 'linking.confirm.replace.linkSubmit'
              )}
        </button>
      </div>
    </form>
  )
}
