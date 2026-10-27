/**
 * Avatars page (owner, 2026-10-27). The avatars the user uploaded, the one
 * they wear now, and a details sheet with a Wear button.
 *
 * One unified page, like Friends: with ALL selected, VRChat and ChilloutVR
 * share the same "Wearing now" row (side by side, equal size) and one uploads
 * grid sorted by name, so neither platform leads. Per-platform states (not
 * connected, loading, failed) use the same one-line notice. Data loads when
 * the page opens and when the user presses Refresh, never on a timer.
 */
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { AvatarItem, AvatarLibraryFailure, AvatarLibraryResult } from '@shared/avatarLibrary'
import type { AuthStatus, Platform } from '@shared/types'
import { useAuthStatus } from '../queries/auth'
import { useAvatarLibrary } from '../queries/avatarLibrary'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'
import { isNotConnectedAuth } from '../hooks/useNotConnectedGate'
import AvatarCard from './AvatarCard'
import AvatarSheet from './AvatarSheet'

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']

/** Quoted literals keep the locale parity scan aware of these key families. */
const NOT_CONNECTED_KEYS: Record<Platform, string> = {
  vrchat: 'avatars.notConnected.vrchat',
  chilloutvr: 'avatars.notConnected.chilloutvr'
}
const NO_CURRENT_KEYS: Record<Platform, string> = {
  vrchat: 'avatars.noCurrent.vrchat',
  chilloutvr: 'avatars.noCurrent.chilloutvr'
}
const ERROR_KEYS: Record<AvatarLibraryFailure, string> = {
  unavailable: 'avatars.error.unavailable',
  'rate-limited': 'avatars.error.rate-limited',
  'not-authenticated': 'avatars.error.not-authenticated'
}

const UPLOAD_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
  gap: 'var(--space-3)'
}
/** Two equal columns: one worn avatar per platform, side by side. */
const WORN_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: 'var(--space-3)'
}

type SourceState =
  | { kind: 'auth-pending' | 'not-connected' | 'loading' }
  | { kind: 'failed'; reason: AvatarLibraryFailure }
  | { kind: 'ready'; result: Extract<AvatarLibraryResult, { ok: true }> }

function sourceState(
  auth: UseQueryResult<AuthStatus, Error>,
  library: UseQueryResult<AvatarLibraryResult, Error>
): SourceState {
  if (auth.data === undefined && auth.isPending) return { kind: 'auth-pending' }
  if (isNotConnectedAuth(auth)) return { kind: 'not-connected' }
  const result = library.data
  if (result === undefined) {
    return library.isError ? { kind: 'failed', reason: 'unavailable' } : { kind: 'loading' }
  }
  return result.ok ? { kind: 'ready', result } : { kind: 'failed', reason: result.reason }
}

export default function AvatarsView(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const platformFilter = useFriendsStore((s) => s.platformFilter)
  const shown = PLATFORMS.filter(
    (platform) => platformFilter === 'all' || platformFilter === platform
  )
  const vrcAuth = useAuthStatus('vrchat')
  const cvrAuth = useAuthStatus('chilloutvr')
  const vrcLibrary = useAvatarLibrary('vrchat', shown.includes('vrchat'))
  const cvrLibrary = useAvatarLibrary('chilloutvr', shown.includes('chilloutvr'))
  const libraries: Record<Platform, UseQueryResult<AvatarLibraryResult, Error>> = {
    vrchat: vrcLibrary,
    chilloutvr: cvrLibrary
  }
  const sources = shown.map((platform) => ({
    platform,
    state: sourceState(platform === 'vrchat' ? vrcAuth : cvrAuth, libraries[platform])
  }))
  const ready = sources.flatMap(({ platform, state }) =>
    state.kind === 'ready' ? [{ platform, result: state.result }] : []
  )

  const [selection, setSelection] = useState<AvatarItem | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const openSheet = useCallback((avatar: AvatarItem, opener: HTMLElement) => {
    openerRef.current = opener
    setSelection(avatar)
  }, [])
  const closeSheet = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    setSelection(null)
    // A card that left the page hands focus to the top of the page instead.
    if (opener?.isConnected) opener.focus()
    else topRef.current?.focus()
  }, [])

  const refreshable = shown.filter((platform) => libraries[platform].isEnabled !== false)
  const refreshing = refreshable.some((platform) => libraries[platform].isFetching)
  const selectedLibrary = selection ? libraries[selection.platform].data : undefined
  const wornAvatarId = selectedLibrary?.ok ? (selectedLibrary.current?.avatarId ?? null) : null

  const worn = ready.flatMap(({ result }) => (result.current ? [result.current] : []))
  const wornIds = new Set(worn.map((avatar) => `${avatar.platform}:${avatar.avatarId}`))
  const collator = new Intl.Collator(i18n.language, { sensitivity: 'base', numeric: true })
  // Name order keeps the mixed grid neutral: no platform is listed first.
  const uploads = ready
    .flatMap(({ result }) => result.avatars)
    .sort((a, b) => collator.compare(a.name, b.name) || a.platform.localeCompare(b.platform))
  const anyIncomplete = ready.some(({ result }) => !result.complete)

  return (
    <div>
      <div
        ref={topRef}
        tabIndex={-1}
        className="mb-[var(--space-4)] flex items-center justify-end focus:outline-none"
      >
        <button
          type="button"
          onClick={() => {
            for (const platform of refreshable) void libraries[platform].refetch()
          }}
          disabled={refreshing || refreshable.length === 0}
          className="rounded-control px-[var(--space-3)] py-[var(--space-2)] text-sm text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] disabled:cursor-default disabled:opacity-60 motion-safe:transition-colors"
        >
          {refreshing ? t('avatars.refreshing') : t('avatars.refresh')}
        </button>
      </div>

      {sources.some(({ state }) => state.kind !== 'ready') ? (
        <div className="mb-[var(--space-4)] flex flex-col gap-[var(--space-2)]">
          {sources.map(({ platform, state }) =>
            state.kind === 'ready' ? null : (
              <SourceNotice
                key={platform}
                platform={platform}
                state={state}
                onRetry={() => void libraries[platform].refetch()}
              />
            )
          )}
        </div>
      ) : null}

      {ready.length > 0 ? (
        <div className="flex flex-col gap-[var(--space-6)]">
          <section aria-label={t('avatars.wearingNow')}>
            <SubHeading>{t('avatars.wearingNow')}</SubHeading>
            {worn.length > 0 ? (
              <div style={WORN_GRID}>
                {worn.map((avatar) => (
                  <AvatarCard
                    key={`${avatar.platform}:${avatar.avatarId}`}
                    avatar={avatar}
                    worn
                    onOpen={openSheet}
                    layout="bar"
                  />
                ))}
              </div>
            ) : null}
            {ready.map(({ platform, result }) =>
              result.current ? null : (
                <p key={platform} className="mt-[var(--space-2)] text-sm text-[var(--text-dim)]">
                  {t(NO_CURRENT_KEYS[platform])}
                </p>
              )
            )}
          </section>
          <section aria-label={t('avatars.yourUploads')}>
            <SubHeading>
              {t('avatars.yourUploads')}
              <span className="ml-[var(--space-2)] normal-case tracking-normal text-[var(--text-faint)]">
                {t('avatars.uploadCount', { count: uploads.length })}
              </span>
            </SubHeading>
            {uploads.length === 0 ? (
              <p className="text-sm text-[var(--text-dim)]">{t('avatars.empty')}</p>
            ) : (
              <div style={UPLOAD_GRID}>
                {uploads.map((avatar) => (
                  <AvatarCard
                    key={`${avatar.platform}:${avatar.avatarId}`}
                    avatar={avatar}
                    worn={wornIds.has(`${avatar.platform}:${avatar.avatarId}`)}
                    onOpen={openSheet}
                  />
                ))}
              </div>
            )}
            {anyIncomplete ? (
              <p className="mt-[var(--space-2)] text-xs text-[var(--text-dim)]">
                {t('avatars.partial')}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      <AvatarSheet avatar={selection} wornAvatarId={wornAvatarId} onClose={closeSheet} />
    </div>
  )
}

function SourceNotice({
  platform,
  state,
  onRetry
}: {
  platform: Platform
  state: Exclude<SourceState, { kind: 'ready' }>
  onRetry: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const setSettingsCategory = useUiStore((s) => s.setSettingsCategory)
  const platformName = t(platform === 'vrchat' ? 'dashboard.platformVrc' : 'dashboard.platformCvr')

  let text: string
  let action: React.JSX.Element | null = null
  let tone = 'text-[var(--text-dim)]'
  if (state.kind === 'not-connected') {
    text = t(NOT_CONNECTED_KEYS[platform])
    action = (
      <button
        type="button"
        onClick={() => {
          setActiveTab('settings')
          setSettingsCategory('accounts')
        }}
        className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text)] bg-[var(--control-fill)] hover:bg-[var(--control-fill-hover)] motion-safe:transition-colors"
      >
        {t('avatars.notConnected.openAccounts')}
      </button>
    )
  } else if (state.kind === 'failed') {
    text = t(ERROR_KEYS[state.reason], { platform: platformName })
    tone = 'text-[var(--error)]'
    action = (
      <button
        type="button"
        onClick={onRetry}
        className="rounded-control px-[var(--space-2)] py-[var(--space-1)] text-xs text-[var(--text-dim)] hover:bg-[var(--surface-hover)] motion-safe:transition-colors"
      >
        {t('avatars.retry')}
      </button>
    )
  } else {
    text = t('avatars.loadingPlatform', { platform: platformName })
  }

  return (
    <div
      role={state.kind === 'failed' ? 'alert' : 'status'}
      className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)]"
    >
      {/* The notice text names the platform, so the dot is never the only cue. */}
      <span
        aria-hidden="true"
        className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
        style={{ background: platform === 'vrchat' ? 'var(--vrc)' : 'var(--cvr)' }}
      />
      <p className={`text-sm ${tone}`}>{text}</p>
      {action}
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="mb-[var(--space-2)] text-[10.5px] font-semibold uppercase tracking-[1.4px] text-[var(--text-dim)]">
      {children}
    </h2>
  )
}
