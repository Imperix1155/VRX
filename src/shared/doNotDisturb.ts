/**
 * Do not disturb for VRX alerts. One decision for desktop notifications and
 * XSOverlay: a timed mute, "until off", or the user's own VRChat status when
 * they asked alerts to follow it. ChilloutVR has no status, so that switch
 * never mutes for it. Nothing here talks to a platform.
 */
import type { OwnStatus } from './ownProfile'
import type { Platform } from './types'

export const DO_NOT_DISTURB_CHOICES = ['off', '1h', '3h', 'until-off'] as const
export type DoNotDisturbChoice = (typeof DO_NOT_DISTURB_CHOICES)[number]

export const DO_NOT_DISTURB_MS = {
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000
} as const

const TIMED: ReadonlySet<DoNotDisturbChoice> = new Set(['1h', '3h'])

export function isDoNotDisturbChoice(value: unknown): value is DoNotDisturbChoice {
  return typeof value === 'string' && (DO_NOT_DISTURB_CHOICES as readonly string[]).includes(value)
}

/** True while a chosen mute is still in force. A past deadline is off. */
export function isDoNotDisturbActive(
  choice: DoNotDisturbChoice,
  until: number | null,
  now: number
): boolean {
  if (choice === 'until-off') return true
  if (!TIMED.has(choice)) return false
  return typeof until === 'number' && Number.isFinite(until) && until > now
}

/** Ask Me and Do Not Disturb. Online and Join Me do not mute. */
export function statusMutesAlerts(status: OwnStatus | null): boolean {
  return status === 'ask-me' || status === 'dnd'
}

export interface AlertMuteInput {
  doNotDisturb: DoNotDisturbChoice
  doNotDisturbUntil: number | null
  doNotDisturbFollowStatus: boolean
  ownStatus: OwnStatus | null
  now: number
}

/** The single mute decision. Callers deliver an alert only when this is false. */
export function alertsMuted(input: AlertMuteInput): boolean {
  if (isDoNotDisturbActive(input.doNotDisturb, input.doNotDisturbUntil, input.now)) return true
  return input.doNotDisturbFollowStatus && statusMutesAlerts(input.ownStatus)
}

export function startDoNotDisturb(
  choice: DoNotDisturbChoice,
  now: number
): { doNotDisturb: DoNotDisturbChoice; doNotDisturbUntil: number | null } {
  if (choice === '1h' || choice === '3h') {
    return { doNotDisturb: choice, doNotDisturbUntil: now + DO_NOT_DISTURB_MS[choice] }
  }
  return { doNotDisturb: choice, doNotDisturbUntil: null }
}

export type DoNotDisturbRemain =
  | { kind: 'off' }
  | { kind: 'until-off' }
  | { kind: 'under-a-minute' }
  | { kind: 'minutes'; count: number }
  | { kind: 'hours'; count: number }
  | { kind: 'hours-minutes'; hours: number; minutes: number }

/** What the settings row and the sidebar say about the current mute. */
export function doNotDisturbRemain(
  choice: DoNotDisturbChoice,
  until: number | null,
  now: number
): DoNotDisturbRemain {
  if (choice === 'until-off') return { kind: 'until-off' }
  if (!isDoNotDisturbActive(choice, until, now) || until === null) return { kind: 'off' }
  const left = until - now
  if (left < 60_000) return { kind: 'under-a-minute' }
  const totalMinutes = Math.ceil(left / 60_000)
  if (totalMinutes < 60) return { kind: 'minutes', count: totalMinutes }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? { kind: 'hours', count: hours } : { kind: 'hours-minutes', hours, minutes }
}

export type GameWatchStep =
  | { action: 'ignore' }
  | { action: 'baseline'; seen: Set<Platform> }
  | { action: 'keep'; seen: Set<Platform> }
  | { action: 'end' }

export function doNotDisturbAfterGames(input: {
  active: boolean
  endOnGameStart: boolean
  seen: ReadonlySet<Platform> | null
  running: ReadonlySet<Platform>
}): GameWatchStep {
  if (!input.active || !input.endOnGameStart) return { action: 'ignore' }
  if (input.seen === null) return { action: 'baseline', seen: new Set(input.running) }
  for (const platform of input.running) {
    if (!input.seen.has(platform)) return { action: 'end' }
  }
  return { action: 'keep', seen: new Set(input.running) }
}

/** Skip both alert sinks together. The test button does not use this. */
export function gateAlert<T>(options: {
  muted: () => boolean
  deliver: (alert: T) => void
}): (alert: T) => void {
  return (alert) => {
    if (options.muted()) return
    options.deliver(alert)
  }
}
