import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExplorePlatformSnapshot } from '@shared/explore'
import type { AuthStatus, Platform } from '@shared/types'
import {
  clearExplorePlatform,
  readExploreSnapshot,
  requestExplore,
  exploreQueryKey,
  setExploreImagePlatforms
} from '../queries/explore'
import { useAuthStatus } from '../queries/auth'
import { queryClient } from '../queries/queryClient'
import { useFriendsStore } from '../stores/friends'
import { useUiStore } from '../stores/ui'

const PLATFORMS: readonly Platform[] = ['vrchat', 'chilloutvr']
const AUTOMATIC_MIN_MS = 5 * 60_000
const automaticAttempts = new Map<string, number>()

function attemptKey(platform: Platform, accountId: string): string {
  return `${platform}:${accountId}`
}

export function clearExploreAutomaticGate(platform: Platform): void {
  for (const key of automaticAttempts.keys()) {
    if (key.startsWith(`${platform}:`)) automaticAttempts.delete(key)
  }
}

/** Pure, timer-free renderer guard. Main remains canonical for all wire budgets. */
export function eligibleExploreAutomatic(
  platform: Platform,
  auth: AuthStatus | undefined,
  snapshot: ExplorePlatformSnapshot | undefined,
  now = Date.now()
): boolean {
  if (auth?.accountId === null || auth?.accountId === undefined) return false
  if (auth.state !== 'authenticated' && auth.state !== 'error') return false
  const stale =
    snapshot === undefined ||
    snapshot.isStale ||
    snapshot.updatedAt === null ||
    now - snapshot.updatedAt >= 60_000
  if (!stale) return false
  const last = automaticAttempts.get(attemptKey(platform, auth.accountId))
  return last === undefined || now - last >= AUTOMATIC_MIN_MS
}

function selectedPlatforms(
  filter: 'all' | Platform,
  statuses: Record<Platform, AuthStatus | undefined>
): Platform[] {
  return PLATFORMS.filter((platform) => {
    const status = statuses[platform]
    return (
      (filter === 'all' || filter === platform) &&
      status?.accountId !== null &&
      status?.accountId !== undefined &&
      (status.state === 'authenticated' || status.state === 'error')
    )
  })
}

function effectiveStatus(
  status: AuthStatus | undefined,
  updatedAt: number,
  retained: RetainedExploreAccount
): AuthStatus | undefined {
  if (status?.state === 'authenticated' && updatedAt <= retained.acceptedAfter) return undefined
  if (status?.state === 'error' && status.accountId === null && retained.accountId !== null) {
    return { ...status, accountId: retained.accountId }
  }
  return status
}

/** Instance-scoped proof of the last authenticated account. A later transient
 * error may omit its account id, but an identity boundary clears this proof
 * before any more automatic work can be considered. */
interface RetainedExploreAccount {
  accountId: string | null
  /** Cache update timestamp below which an authenticated status predates a boundary. */
  acceptedAfter: number
}

type RetainedExploreAccounts = Record<Platform, RetainedExploreAccount>

interface ActiveDeclaration {
  key: string
  promise: Promise<void>
}

interface ActiveDeclarationState {
  successful: string | undefined
  pending: ActiveDeclaration | undefined
}

function activeDeclarationKey(relevant: boolean, active: readonly Platform[]): string {
  return relevant ? active.join(',') : ''
}

function useRetainedExploreAccounts(
  vrc: AuthStatus | undefined,
  vrcUpdatedAt: number,
  cvr: AuthStatus | undefined,
  cvrUpdatedAt: number
): {
  accounts: RetainedExploreAccounts
  clear: (platform: Platform) => void
} {
  const [accounts, setAccounts] = useState<RetainedExploreAccounts>({
    vrchat: { accountId: null, acceptedAfter: 0 },
    chilloutvr: { accountId: null, acceptedAfter: 0 }
  })
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setAccounts((current) => {
        const vrchat =
          vrc?.state === 'authenticated' &&
          vrc.accountId !== null &&
          vrcUpdatedAt > current.vrchat.acceptedAfter
            ? { accountId: vrc.accountId, acceptedAfter: current.vrchat.acceptedAfter }
            : current.vrchat
        const chilloutvr =
          cvr?.state === 'authenticated' &&
          cvr.accountId !== null &&
          cvrUpdatedAt > current.chilloutvr.acceptedAfter
            ? { accountId: cvr.accountId, acceptedAfter: current.chilloutvr.acceptedAfter }
            : current.chilloutvr
        return vrchat === current.vrchat && chilloutvr === current.chilloutvr
          ? current
          : { vrchat, chilloutvr }
      })
    })
    return () => {
      cancelled = true
    }
  }, [vrc, vrcUpdatedAt, cvr, cvrUpdatedAt])
  const clear = useCallback((platform: Platform) => {
    setAccounts((current) =>
      current[platform].accountId === null && current[platform].acceptedAfter >= Date.now()
        ? current
        : { ...current, [platform]: { accountId: null, acceptedAfter: Date.now() } }
    )
  }, [])
  return { accounts, clear }
}

/** The sole renderer trigger point for Explore work. */
export function useExploreCoordinator(): void {
  const activeTab = useUiStore((state) => state.activeTab)
  const filter = useFriendsStore((state) => state.platformFilter)
  const vrcQuery = useAuthStatus('vrchat')
  const cvrQuery = useAuthStatus('chilloutvr')
  const vrc = vrcQuery.data
  const cvr = cvrQuery.data
  const { accounts: retainedAccounts, clear: clearRetainedAccount } = useRetainedExploreAccounts(
    vrc,
    vrcQuery.dataUpdatedAt ?? 0,
    cvr,
    cvrQuery.dataUpdatedAt ?? 0
  )
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  )
  const [wake, setWake] = useState(0)
  const activeDeclaration = useRef<ActiveDeclarationState>({
    successful: undefined,
    pending: undefined
  })
  const activationGenerations = useRef<Record<Platform, number>>({ vrchat: 0, chilloutvr: 0 })
  const statuses = useMemo(
    () => ({
      vrchat: effectiveStatus(vrc, vrcQuery.dataUpdatedAt ?? 0, retainedAccounts.vrchat),
      chilloutvr: effectiveStatus(cvr, cvrQuery.dataUpdatedAt ?? 0, retainedAccounts.chilloutvr)
    }),
    [vrc, cvr, vrcQuery.dataUpdatedAt, cvrQuery.dataUpdatedAt, retainedAccounts]
  )
  const active = useMemo(() => selectedPlatforms(filter, statuses), [filter, statuses])
  const relevant = (activeTab === 'dashboard' || activeTab === 'explore') && visible

  useEffect(() => {
    setExploreImagePlatforms([])
    if (typeof window === 'undefined' || !window.vrx?.setExploreActive) return
    let cancelled = false
    const capturedGenerations = { ...activationGenerations.current }
    const platforms = relevant ? active : []
    const key = activeDeclarationKey(relevant, active)
    const known = activeDeclaration.current
    let activation: Promise<void>
    if (known.successful === key) {
      activation = Promise.resolve()
    } else if (known.pending?.key === key) {
      activation = known.pending.promise
    } else {
      const declaration: ActiveDeclaration = {
        key,
        promise: Promise.resolve()
      }
      // A changed declaration invalidates the remembered one. Main may have
      // applied a later-rejected request, so only an exact settled success is
      // safe to reuse on future wakes.
      activeDeclaration.current = { successful: undefined, pending: declaration }
      declaration.promise = window.vrx
        .setExploreActive({ platforms })
        .then(() => {
          if (activeDeclaration.current.pending === declaration) {
            activeDeclaration.current = { successful: key, pending: undefined }
          }
        })
        .catch((error: unknown) => {
          if (activeDeclaration.current.pending === declaration) {
            activeDeclaration.current = { successful: undefined, pending: undefined }
          }
          throw error
        })
      activation = declaration.promise
    }
    void activation
      .then(() => {
        if (cancelled || !relevant || activeDeclaration.current.successful !== key) return
        setExploreImagePlatforms(
          active.filter(
            (platform) => activationGenerations.current[platform] === capturedGenerations[platform]
          )
        )
        const now = Date.now()
        for (const platform of active) {
          if (activationGenerations.current[platform] !== capturedGenerations[platform]) continue
          const auth = statuses[platform]
          const snapshot = queryClient.getQueryData<ExplorePlatformSnapshot>(
            exploreQueryKey(platform)
          )
          if (!eligibleExploreAutomatic(platform, auth, snapshot, now) || auth?.accountId == null)
            continue
          // Record before IPC: focus/online storms coalesce without a delayed retry.
          automaticAttempts.set(attemptKey(platform, auth.accountId), now)
          void requestExplore(platform, 'automatic').catch(() => undefined)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      setExploreImagePlatforms([])
    }
  }, [active, relevant, statuses, wake])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.vrx) return
    const changed = window.vrx.onExploreChanged?.(({ platform }) => {
      void readExploreSnapshot(platform).catch(() => undefined)
    })
    const boundary = window.vrx.onIdentityBoundary?.(({ platform }) => {
      activationGenerations.current[platform] += 1
      clearRetainedAccount(platform)
      clearExploreAutomaticGate(platform)
      clearExplorePlatform(platform)
    })
    const friend = window.vrx.onFriendEvent?.((event) => {
      if (event.type === 'auth-invalidated') {
        activationGenerations.current[event.platform] += 1
        clearRetainedAccount(event.platform)
        clearExploreAutomaticGate(event.platform)
        clearExplorePlatform(event.platform)
      }
      if (event.type === 'connection' && event.health === 'live') {
        if (document.visibilityState === 'visible') setWake((value) => value + 1)
      }
    })
    return () => {
      changed?.()
      boundary?.()
      friend?.()
    }
  }, [clearRetainedAccount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const wakeIfVisible = (): void => {
      if (document.visibilityState === 'visible') setWake((value) => value + 1)
    }
    const onVisibility = (): void => {
      const next = document.visibilityState === 'visible'
      if (!next) {
        // Main clears active Explore platforms while hidden. Reset before the
        // state update so a batched hidden→visible render still redeclares them.
        activeDeclaration.current = { successful: undefined, pending: undefined }
      }
      setVisible(next)
      if (next) wakeIfVisible()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', wakeIfVisible)
    window.addEventListener('online', wakeIfVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', wakeIfVisible)
      window.removeEventListener('online', wakeIfVisible)
    }
  }, [])

  // Only AppShell unmount cancels all work. Dashboard→Explore keeps its jobs/cache.
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.vrx
    return () => {
      activeDeclaration.current = { successful: undefined, pending: undefined }
      void bridge?.setExploreActive?.({ platforms: [] }).catch(() => undefined)
    }
  }, [])
}
