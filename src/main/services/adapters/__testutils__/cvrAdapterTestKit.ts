import type { CVRCredentials } from '../CvrApiClient'
import type { CvrAdapter, CvrCredentialStore } from '../CvrAdapter'

// Shared fixtures for the CvrAdapter*.test.ts suites.

/** In-memory credential store recording persisted sessions + delete calls. */
export function fakeStore(
  initial?: CVRCredentials
): CvrCredentialStore & { saved: CVRCredentials[]; deleted: number } {
  let value = initial
  const store = {
    saved: [] as CVRCredentials[],
    deleted: 0,
    load: () => value,
    save: (credentials: CVRCredentials, accountId: string | null) => {
      void accountId
      value = credentials
      store.saved.push(credentials)
    },
    delete: () => {
      value = undefined
      store.deleted++
    }
  }
  return store
}

/** A full CVR auth payload (the schema reads only username, accessKey and userId). */
export function authPayload(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    username: 'trinity',
    accessKey: 'key-1',
    userId: 'a1b2c3d4-0000-0000-0000-000000000001',
    currentAvatar: 'avatar-guid',
    currentHomeWorld: 'world-guid',
    videoUrlResolverExecutable: '',
    videoUrlResolverHashes: '',
    blockedUsers: [],
    ...overrides
  }
}

export function envelope(data: Record<string, unknown>): { message: string; data: unknown } {
  return { message: 'ok', data }
}

export const creds = { username: 'trinity@example.com', password: 'whiterabbit' }

/** Tests outside restore validation bypass the auth leg deliberately; mark
 *  their synthetic sessions as owner-bound and durable for the behavior under test. */
export function markSessionEstablishedForTest(adapter: CvrAdapter): CvrAdapter {
  Object.assign(adapter as unknown as { validated: boolean }, { validated: true })
  return adapter
}
