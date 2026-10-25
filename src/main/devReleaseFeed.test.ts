import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'
import { installDevStablePromotion } from './devReleaseFeed'

type ProviderUpdater = ConstructorParameters<typeof GitHubProvider>[1]
type ProviderRuntime = ConstructorParameters<typeof GitHubProvider>[2]

function updaterFor(version: string): ProviderUpdater {
  return {
    currentVersion: { raw: version, version },
    channel: 'dev',
    allowPrerelease: true,
    allowDowngrade: true,
    fullChangelog: false
  } as unknown as ProviderUpdater
}

function runtimeFor(
  platform: 'win32' | 'linux',
  request: (options: { path?: string }) => Promise<string>
): ProviderRuntime {
  return { platform, executor: { request } } as unknown as ProviderRuntime
}

const { HttpError } = createRequire(
  createRequire(import.meta.url).resolve('electron-updater/out/providers/GitHubProvider.js')
)('builder-util-runtime') as { HttpError: new (statusCode: number, message?: string) => Error }

beforeAll(() => {
  installDevStablePromotion(GitHubProvider)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function atom(versions: readonly string[]): string {
  return `<feed>${versions
    .map(
      (version) =>
        `<entry><title>${version}</title><link href="https://github.com/example/app/releases/tag/v${version}"/><content>Fixture notes</content></entry>`
    )
    .join('')}</feed>`
}

describe('dev channel stable promotion', () => {
  it.each(['win32', 'linux'] as const)(
    'moves 1.2.0-dev.1 to stable 1.2.0 and still finds stable when no dev tag exists (%s)',
    async (platform) => {
      vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
      const suffix = platform === 'linux' ? '-linux' : ''
      for (const versions of [['1.2.0', '1.2.0-dev.1'], ['1.2.0']]) {
        const requests: string[] = []
        const provider = new GitHubProvider(
          { provider: 'github', owner: 'example', repo: 'app' },
          updaterFor('1.2.0-dev.1'),
          runtimeFor(platform, async (options) => {
            const path = options.path ?? ''
            requests.push(path)
            if (path.endsWith('.atom')) return atom(versions)
            if (path === `/example/app/releases/download/v1.2.0/latest${suffix}.yml`) {
              return 'version: 1.2.0\nfiles: []'
            }
            throw new Error(`Unexpected metadata request: ${path}`)
          })
        )
        expect((await provider.getLatestVersion()).version).toBe('1.2.0')
        expect(requests.some((path) => path.includes('beta'))).toBe(false)
        expect(requests.some((path) => path.endsWith('/latest'))).toBe(false)
      }
    }
  )

  it.each(['win32', 'linux'] as const)(
    'prefers a newer dev build, and a stable release behind a newer beta (%s)',
    async (platform) => {
      vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
      const suffix = platform === 'linux' ? '-linux' : ''
      const cases = [
        {
          installed: '1.2.0-dev.1',
          versions: ['1.3.0-dev.1', '1.2.0', '1.2.0-beta.9'],
          expected: '1.3.0-dev.1',
          file: `dev${suffix}.yml`
        },
        {
          installed: '1.1.0-dev.1',
          versions: ['1.3.0-beta.1', '1.2.0', '1.1.0-dev.2'],
          expected: '1.2.0',
          file: `latest${suffix}.yml`
        },
        {
          installed: '1.2.0-dev.1',
          versions: ['1.2.0-dev.2', '1.2.0-beta.9', '1.1.0'],
          expected: '1.2.0-dev.2',
          file: `dev${suffix}.yml`
        }
      ]
      for (const item of cases) {
        const requests: string[] = []
        const provider = new GitHubProvider(
          { provider: 'github', owner: 'example', repo: 'app' },
          updaterFor(item.installed),
          runtimeFor(platform, async (options) => {
            const path = options.path ?? ''
            requests.push(path)
            if (path.endsWith('.atom')) return atom(item.versions)
            if (path === `/example/app/releases/download/v${item.expected}/${item.file}`) {
              return `version: ${item.expected}\nfiles: []`
            }
            if (path.endsWith('/latest')) throw new HttpError(404, 'Not Found')
            throw new Error(`Unexpected metadata request: ${path}`)
          })
        )
        expect((await provider.getLatestVersion()).version).toBe(item.expected)
        expect(requests.some((path) => path.includes('beta'))).toBe(false)
      }
    }
  )
})
