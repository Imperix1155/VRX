import type { IpcInvokeChannel, IpcNotificationChannel } from '@shared/ipc'

export type RateLimitedIpcChannel = IpcInvokeChannel | IpcNotificationChannel

export interface RateLimitBudget {
  readonly max: number
  readonly windowMs: number
}

export type RateLimitWarn = (
  message: 'IPC rate limit exceeded',
  meta: { channel: RateLimitedIpcChannel }
) => void

interface RateLimitOptions<TResult> {
  clock?: () => number
  deny: () => TResult
  warn?: RateLimitWarn
}

export const IPC_RATE_LIMIT_BUDGETS = {
  // Two platform reconciles plus retries/remounts fit six times over.
  'get-friends': { max: 12, windowMs: 30_000 },
  // Three complete 200-friend paints fit in one burst at the exact boundary.
  'get-avatar': { max: 600, windowMs: 10_000 },
  // Account settings normally loads once; repeated tab mounts stay harmless.
  'get-accounts': { max: 12, windowMs: 30_000 },
  // Two platforms can mount, invalidate, and retry without approaching this cap.
  'get-auth-status': { max: 12, windowMs: 30_000 },
  // Credential submission is human-paced, with room for several corrections.
  login: { max: 6, windowMs: 60_000 },
  // Short-code retries are human-paced but get extra room for mistypes/expiry.
  'verify-2fa': { max: 10, windowMs: 60_000 },
  // Sign-out is a deliberate human action and normally happens once.
  logout: { max: 6, windowMs: 60_000 },
  // Existing 3s per-friend cooldown permits at most 20 successful joins/minute.
  'join-instance': { max: 20, windowMs: 60_000 },
  // Existing 3s action cooldown permits at most 20 successful invites/minute.
  'self-invite': { max: 20, windowMs: 60_000 },
  // The 7.5s status poll runs eight times/minute; this is a 3x allowance.
  'get-app-status': { max: 24, windowMs: 60_000 },
  // External links are human-clicked; 30/minute still bounds a click loop.
  'open-url': { max: 30, windowMs: 60_000 },
  // Settings hydrate once per renderer load, with ample reload/remount headroom.
  'get-settings': { max: 12, windowMs: 30_000 },
  // Every settings mutation persists; two changes/second allows rapid controls.
  'save-settings': { max: 120, windowMs: 60_000 },
  // Drawer reads can follow rapid roster navigation without blocking the user.
  'get-friend-note': { max: 90, windowMs: 60_000 },
  // Blur-triggered note saves are human-paced; one/second is generous.
  'set-friend-note': { max: 60, windowMs: 60_000 },
  // Hydration is once per renderer load; three allows dev remount/reload churn.
  'renderer-hydrated': { max: 3, windowMs: 60_000 }
} as const satisfies Record<RateLimitedIpcChannel, RateLimitBudget>

/** Existing structured result channels keep their result shape on denial. */
export function ipcRateLimitDenial(channel: IpcInvokeChannel): unknown {
  switch (channel) {
    case 'login':
    case 'verify-2fa':
      return { ok: false, needs2fa: false, error: 'rate_limited' }
    case 'join-instance':
    case 'self-invite':
    case 'set-friend-note':
      return { ok: false, reason: 'rate-limited' }
    default:
      throw new Error('rate_limited')
  }
}

/** Pure per-channel sliding window. No timers and no shared/global counters. */
export function withRateLimit<TArgs extends unknown[], TResult>(
  channel: RateLimitedIpcChannel,
  budget: RateLimitBudget,
  handler: (...args: TArgs) => TResult,
  options: RateLimitOptions<TResult>
): (...args: TArgs) => TResult {
  const clock = options.clock ?? (() => performance.now())
  const timestamps: number[] = []
  let lastNow = Number.NEGATIVE_INFINITY
  let nextWarningAt = Number.NEGATIVE_INFINITY

  const isAllowed = (): boolean => {
    try {
      if (!Number.isFinite(budget.max) || budget.max <= 0) return true
      if (!Number.isFinite(budget.windowMs) || budget.windowMs <= 0) return true

      const now = clock()
      if (!Number.isFinite(now) || now < lastNow) return true
      lastNow = now

      const cutoff = now - budget.windowMs
      while (timestamps[0] !== undefined && timestamps[0] <= cutoff) timestamps.shift()

      if (timestamps.length < budget.max) {
        timestamps.push(now)
        return true
      }

      if (now >= nextWarningAt) {
        nextWarningAt = timestamps[0]! + budget.windowMs
        try {
          options.warn?.('IPC rate limit exceeded', { channel })
        } catch {
          // Logging must never make a denial crash the main process.
        }
      }
      return false
    } catch {
      // A limiter fault must fail open so normal IPC behavior is preserved.
      return true
    }
  }

  return (...args: TArgs): TResult => {
    if (!isAllowed()) return options.deny()
    return handler(...args)
  }
}
