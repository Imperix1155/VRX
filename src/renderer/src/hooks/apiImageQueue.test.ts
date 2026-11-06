import { describe, expect, it, vi } from 'vitest'
import { ApiImageQueue, DROPPED, isApiImageUrl } from './apiImageQueue'

function deferred(): { promise: Promise<string | null>; resolve: (value: string | null) => void } {
  let resolve!: (value: string | null) => void
  const promise = new Promise<string | null>((done) => (resolve = done))
  return { promise, resolve }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('ApiImageQueue', () => {
  it('knows which pictures go through the VRChat request queue', () => {
    expect(isApiImageUrl('https://api.vrchat.cloud/api/1/image/file_a/1/256')).toBe(true)
    expect(isApiImageUrl('https://files.vrchat.cloud/thumbnails/a.png')).toBe(false)
    expect(isApiImageUrl('https://files.chilloutvr.net/a.png')).toBe(false)
    expect(isApiImageUrl('not a url')).toBe(false)
  })

  it('hands main only a few downloads at once, in page order', async () => {
    const queue = new ApiImageQueue(2)
    const sends = ['a', 'b', 'c', 'd'].map(() => deferred())
    const started: string[] = []
    const results = ['a', 'b', 'c', 'd'].map((key, index) => {
      queue.watch(key, index, true)
      return queue.enqueue(key, () => {
        started.push(key)
        return sends[index]!.promise
      })
    })
    expect(started).toEqual(['a', 'b'])
    expect(queue.waiting).toBe(2)

    sends[0]!.resolve('data:a')
    await expect(results[0]).resolves.toBe('data:a')
    await flush()
    expect(started).toEqual(['a', 'b', 'c'])
    sends[1]!.resolve(null)
    await expect(results[1]).resolves.toBeNull()
    await flush()
    expect(started).toEqual(['a', 'b', 'c', 'd'])
  })

  it('serves tiles on screen before tiles scrolled away, which wait', async () => {
    const queue = new ApiImageQueue(1)
    const first = deferred()
    const started: string[] = []
    queue.watch('busy', 1, true)
    void queue.enqueue('busy', () => {
      started.push('busy')
      return first.promise
    })
    queue.watch('hidden', 2, false)
    const hidden = queue.enqueue('hidden', () => {
      started.push('hidden')
      return Promise.resolve('data:hidden')
    })
    queue.watch('shown', 3, true)
    void queue.enqueue('shown', () => {
      started.push('shown')
      return Promise.resolve('data:shown')
    })

    first.resolve('data:busy')
    await flush()
    expect(started).toEqual(['busy', 'shown'])
    expect(queue.waiting).toBe(1)

    // Scrolled back into view: its turn comes.
    queue.watch('hidden', 2, true)
    await expect(hidden).resolves.toBe('data:hidden')
    expect(started).toEqual(['busy', 'shown', 'hidden'])
  })

  it('drops a waiting download once every tile that wanted it is gone', async () => {
    const queue = new ApiImageQueue(1)
    const first = deferred()
    queue.watch('busy', 1, true)
    void queue.enqueue('busy', () => first.promise)
    const send = vi.fn(() => Promise.resolve('data:left'))
    queue.watch('left', 2, true)
    queue.watch('left', 3, true)
    const left = queue.enqueue('left', send)

    queue.release('left', 2)
    expect(queue.waiting).toBe(1)
    queue.release('left', 3)
    await expect(left).resolves.toBe(DROPPED)
    expect(queue.waiting).toBe(0)

    first.resolve('data:busy')
    await flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('never lines up a picture that no tile is watching', async () => {
    const queue = new ApiImageQueue(2)
    const send = vi.fn(() => Promise.resolve('data:x'))
    await expect(queue.enqueue('nobody', send)).resolves.toBe(DROPPED)
    expect(send).not.toHaveBeenCalled()
  })

  it('treats a failed send as no picture and keeps the line moving', async () => {
    const queue = new ApiImageQueue(1)
    queue.watch('bad', 1, true)
    queue.watch('next', 2, true)
    const bad = queue.enqueue('bad', () => Promise.reject(new Error('bridge')))
    const next = queue.enqueue('next', () => Promise.resolve('data:next'))
    await expect(bad).resolves.toBeNull()
    await expect(next).resolves.toBe('data:next')
    expect(queue.running).toBe(0)
  })
})
