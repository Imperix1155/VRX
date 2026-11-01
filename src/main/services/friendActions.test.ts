import { describe, expect, it, vi } from 'vitest'
import {
  FRIEND_ACTION_MAX_WAITING,
  FRIEND_ACTION_SPACING_MS,
  type FriendRequestAnswer
} from '@shared/friendActions'
import type { Platform } from '@shared/types'
import {
  FriendActionRefusedError,
  FriendActionUnavailableError,
  type FriendActionsAdapter,
  type FriendRequestRecord
} from './adapters/FriendActionsAdapter'
import { AuthError, NetworkError, RateLimitError } from './adapters/errors'
import type { RequestLease } from './adapters/RequestLease'
import { FriendActionsService, MAX_SENT_FRIEND_REQUESTS } from './friendActions'

const VRC_USER = 'usr_5a3c1e2d-0000-4000-8000-000000000001'
const CVR_USER = 'B81D5892-5119-4F44-B473-7BF4FFDA0458'
const ROW = 'friend-request:not_5a3c1e2d-0000-4000-8000-000000000001'

class FakeAdapter implements FriendActionsAdapter {
  generation = 1
  signedIn = true
  error: Error | null = null
  gate: Promise<void> | null = null
  readonly answerFriendRequest = vi.fn(
    async (record: FriendRequestRecord, answer: FriendRequestAnswer, lease: RequestLease) => {
      void record
      void answer
      void lease
      if (this.gate) await this.gate
      if (this.error) throw this.error
    }
  )
  readonly sendFriendRequest = vi.fn(async (userId: string, lease: RequestLease) => {
    void userId
    void lease
    if (this.gate) await this.gate
    if (this.error) throw this.error
  })

  constructor(readonly platform: Platform) {}

  captureFriendActionLease(): RequestLease {
    if (!this.signedIn) throw new AuthError()
    const generation = this.generation
    return {
      generation,
      signal: new AbortController().signal,
      isCurrent: () => this.signedIn && generation === this.generation
    }
  }
}

function setup(): {
  vrc: FakeAdapter
  cvr: FakeAdapter
  service: FriendActionsService
  rows: Map<string, FriendRequestRecord>
  dismiss: ReturnType<typeof vi.fn>
  listed: Set<string>
  friends: Set<string>
  now: { value: number }
  sleeps: number[]
  log: ReturnType<typeof vi.fn>
} {
  const vrc = new FakeAdapter('vrchat')
  const cvr = new FakeAdapter('chilloutvr')
  const rows = new Map<string, FriendRequestRecord>([
    [`vrchat|${ROW}`, { sourceId: ROW.slice('friend-request:'.length), senderId: VRC_USER }]
  ])
  const listed = new Set<string>()
  const friends = new Set<string>()
  const now = { value: 10_000 }
  const sleeps: number[] = []
  const log = vi.fn()
  const dismiss = vi.fn((platform: Platform, id: string) => rows.delete(`${platform}|${id}`))
  const service = new FriendActionsService({
    adapters: new Map<Platform, FriendActionsAdapter>([
      ['vrchat', vrc],
      ['chilloutvr', cvr]
    ]),
    inbox: {
      friendRequest: (platform, id) => rows.get(`${platform}|${id}`) ?? null,
      dismiss
    },
    wasListed: (platform, userId) => listed.has(`${platform}|${userId}`),
    isFriend: (platform, userId) => friends.has(`${platform}|${userId}`),
    clock: () => now.value,
    sleep: (ms) => {
      sleeps.push(ms)
      now.value += ms
      return Promise.resolve()
    },
    log
  })
  return { vrc, cvr, service, rows, dismiss, listed, friends, now, sleeps, log }
}

describe('FriendActionsService answers', () => {
  it('sends one answer for a row main holds and hides the row once it went out', async () => {
    const { vrc, service, dismiss } = setup()
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({ ok: true })
    expect(vrc.answerFriendRequest).toHaveBeenCalledTimes(1)
    expect(vrc.answerFriendRequest.mock.calls[0]![0]).toEqual({
      sourceId: 'not_5a3c1e2d-0000-4000-8000-000000000001',
      senderId: VRC_USER
    })
    expect(vrc.answerFriendRequest.mock.calls[0]![1]).toBe('accept')
    expect(dismiss).toHaveBeenCalledWith('vrchat', ROW)
  })

  it('refuses a row main does not hold without any request', async () => {
    const { vrc, cvr, service } = setup()
    await expect(service.answer('vrchat', 'friend-request:not_other', 'decline')).resolves.toEqual({
      ok: false,
      reason: 'unknown-request'
    })
    // The same row ID on the other platform is a different row.
    await expect(service.answer('chilloutvr', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'unknown-request'
    })
    expect(vrc.answerFriendRequest).not.toHaveBeenCalled()
    expect(cvr.answerFriendRequest).not.toHaveBeenCalled()
  })

  it('keeps the row when the platform refuses or cannot be reached', async () => {
    const { vrc, service, dismiss, log } = setup()
    vrc.error = new FriendActionRefusedError('no')
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'refused'
    })
    vrc.error = new NetworkError('HTTP 500')
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    vrc.error = new FriendActionUnavailableError('socket closed')
    await expect(service.answer('vrchat', ROW, 'decline')).resolves.toEqual({
      ok: false,
      reason: 'unavailable'
    })
    vrc.error = new RateLimitError(1_000)
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'rate-limited'
    })
    vrc.error = new AuthError(undefined, 401)
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(dismiss).not.toHaveBeenCalled()
    // Logs carry no row or person.
    for (const [, meta] of log.mock.calls) {
      expect(JSON.stringify(meta)).not.toContain('usr_')
      expect(JSON.stringify(meta)).not.toContain('not_')
    }
  })

  it('answers not signed in without touching the adapter', async () => {
    const { vrc, service } = setup()
    vrc.signedIn = false
    await expect(service.answer('vrchat', ROW, 'accept')).resolves.toEqual({
      ok: false,
      reason: 'not-authenticated'
    })
    expect(vrc.answerFriendRequest).not.toHaveBeenCalled()
  })

  it('joins a second press on the same row instead of sending twice', async () => {
    const { vrc, service } = setup()
    let open!: () => void
    vrc.gate = new Promise((resolve) => (open = resolve))
    const first = service.answer('vrchat', ROW, 'accept')
    const second = service.answer('vrchat', ROW, 'decline')
    open()
    await expect(first).resolves.toEqual({ ok: true })
    await expect(second).resolves.toEqual({ ok: true })
    expect(vrc.answerFriendRequest).toHaveBeenCalledTimes(1)
  })
})

describe('FriendActionsService spacing', () => {
  it('spaces actions on one platform, failed ones too, and never across platforms', async () => {
    const { vrc, cvr, service, listed, sleeps, now } = setup()
    listed.add(`vrchat|${VRC_USER}`)
    listed.add(`chilloutvr|${CVR_USER.toLowerCase()}`)
    vrc.error = new NetworkError('HTTP 500')
    await service.answer('vrchat', ROW, 'accept')
    vrc.error = null
    now.value += 500
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({ ok: true })
    expect(sleeps).toEqual([FRIEND_ACTION_SPACING_MS - 500])
    // ChilloutVR keeps its own pace.
    await expect(service.send('chilloutvr', CVR_USER)).resolves.toEqual({ ok: true })
    expect(sleeps).toHaveLength(1)
    expect(cvr.sendFriendRequest).toHaveBeenCalledWith(
      CVR_USER.toLowerCase(),
      expect.objectContaining({ generation: 1 })
    )
  })

  it('lets a few presses wait their turn and refuses the rest as busy', async () => {
    const { vrc, service, rows, log } = setup()
    for (let index = 0; index < FRIEND_ACTION_MAX_WAITING + 1; index++) {
      rows.set(`vrchat|friend-request:not_${index}`, { sourceId: `not_${index}`, senderId: 'x' })
    }
    let open!: () => void
    vrc.gate = new Promise((resolve) => (open = resolve))
    const results = Array.from({ length: FRIEND_ACTION_MAX_WAITING + 1 }, (_, index) =>
      service.answer('vrchat', `friend-request:not_${index}`, 'accept')
    )
    await expect(results[FRIEND_ACTION_MAX_WAITING]).resolves.toEqual({
      ok: false,
      reason: 'busy'
    })
    open()
    const settled = await Promise.all(results.slice(0, FRIEND_ACTION_MAX_WAITING))
    expect(settled.every((result) => result.ok)).toBe(true)
    expect(vrc.answerFriendRequest).toHaveBeenCalledTimes(FRIEND_ACTION_MAX_WAITING)
    expect(log).toHaveBeenCalledWith('friend action failed', {
      platform: 'vrchat',
      action: 'accept',
      reason: 'busy'
    })
  })

  it('drops a waiting press when the account changes before its turn', async () => {
    const { vrc, service, rows, listed } = setup()
    listed.add(`vrchat|${VRC_USER}`)
    rows.set('vrchat|friend-request:not_b', { sourceId: 'not_b', senderId: 'y' })
    let open!: () => void
    vrc.gate = new Promise((resolve) => (open = resolve))
    const first = service.answer('vrchat', ROW, 'accept')
    const waiting = service.answer('vrchat', 'friend-request:not_b', 'decline')
    await vi.waitFor(() => expect(vrc.answerFriendRequest).toHaveBeenCalledTimes(1))
    service.clearPlatform('vrchat')
    vrc.generation += 1
    open()
    await first
    await expect(waiting).resolves.toEqual({ ok: false, reason: 'not-authenticated' })
    expect(vrc.answerFriendRequest).toHaveBeenCalledTimes(1)
  })
})

describe('FriendActionsService friend requests', () => {
  it('sends only to someone a search listed who is not a friend or malformed', async () => {
    const { vrc, service, listed, friends } = setup()
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    await expect(service.send('vrchat', '../auth/user')).resolves.toEqual({
      ok: false,
      reason: 'unknown-person'
    })
    listed.add(`vrchat|${VRC_USER}`)
    friends.add(`vrchat|${VRC_USER}`)
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({
      ok: false,
      reason: 'already-friends'
    })
    expect(vrc.sendFriendRequest).not.toHaveBeenCalled()
  })

  it('sends once per person per session; a second press says sent again without a request', async () => {
    const { vrc, service, listed } = setup()
    listed.add(`vrchat|${VRC_USER}`)
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({ ok: true })
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({ ok: true })
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(1)
    // A new session may ask again.
    vrc.generation += 1
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({ ok: true })
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(2)
  })

  it('remembers a failed send as not sent', async () => {
    const { vrc, service, listed } = setup()
    listed.add(`vrchat|${VRC_USER}`)
    vrc.error = new FriendActionRefusedError('no')
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({
      ok: false,
      reason: 'refused'
    })
    vrc.error = null
    await expect(service.send('vrchat', VRC_USER)).resolves.toEqual({ ok: true })
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(2)
  })

  it('bounds the sent memory, forgetting the oldest first', async () => {
    const { vrc, service, listed } = setup()
    const ids = Array.from({ length: MAX_SENT_FRIEND_REQUESTS + 1 }, (_, n) => `person${n}`)
    for (const id of ids) {
      listed.add(`vrchat|${id}`)
      await service.send('vrchat', id)
    }
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(ids.length)
    await service.send('vrchat', ids[ids.length - 1]!)
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(ids.length)
    await service.send('vrchat', ids[0]!)
    expect(vrc.sendFriendRequest).toHaveBeenCalledTimes(ids.length + 1)
  })
})
