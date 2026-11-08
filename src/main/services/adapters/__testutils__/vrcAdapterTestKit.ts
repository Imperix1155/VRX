import type { vi } from 'vitest'
import type { VrcCredentialStore } from '../VrcAdapter'

// Shared fixtures for the VrcAdapter*.test.ts suites.

/** In-memory credential store that records persisted values + delete calls for assertions. */
export function fakeStore(
  initial?: string
): VrcCredentialStore & { saved: string[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as string[],
    deleted: 0,
    load: () => value,
    save: (cookie: string, accountId: string | null) => {
      void accountId
      value = cookie
      store.saved.push(cookie)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

export const creds = { username: 'neo', password: 'redpill' }

type SocketListener = (...args: unknown[]) => void
export class DrivableVrcSocket {
  private readonly listeners = new Map<string, SocketListener[]>()
  closed = false

  on(event: string, listener: SocketListener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.fire('close')
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

export const pipelineFrame = (type: string, content: unknown): string =>
  JSON.stringify({ type, content: JSON.stringify(content) })

export const pipelineUser = {
  id: 'usr_late',
  displayName: 'Late Friend',
  currentAvatarThumbnailImageUrl: null,
  status: 'active',
  statusDescription: null,
  tags: []
}

export function lastCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit]
}
export function headerOf(options: RequestInit, name: string): string | undefined {
  return (options.headers as Record<string, string>)[name]
}
