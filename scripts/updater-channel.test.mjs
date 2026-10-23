import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'
import { SemVer } from 'electron-updater/node_modules/semver/index.js'

// Load HttpError from the copy the provider itself resolves, so its 404 check matches.
const { HttpError } = createRequire(
  createRequire(import.meta.url).resolve('electron-updater/out/providers/GitHubProvider.js')
)('builder-util-runtime')

// Exercise the locked provider with a synthetic feed, never real GitHub or downloads.
const versions = ['1.2.0-rc.2', '1.2.0-beta.2', '1.1.0', '1.0.0-rc.2']
const feed = `<feed>${versions.map((version) => `<entry><title>${version}</title><link href="https://github.com/example/app/releases/tag/v${version}"/><content>Fixture notes</content></entry>`).join('')}</feed>`
afterEach(() => vi.unstubAllEnvs())

describe('locked GitHub updater channel behavior', () => {
  it.each(['win32', 'linux'])(
    'stable ignores newer prereleases; beta follows beta; rc stays rc (%s)',
    async (platform) => {
      vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
      for (const [installed, allowed, expected, channel] of [
        ['1.0.0', false, '1.1.0', 'latest'],
        ['1.2.0-beta.1', true, '1.2.0-beta.2', 'beta'],
        ['1.0.0-rc.1', true, '1.2.0-rc.2', 'rc']
      ]) {
        const requests = []
        const provider = new GitHubProvider(
          {
            provider: 'github',
            owner: 'example',
            repo: 'app',
            channel: installed.includes('-') ? installed.split('-')[1].split('.')[0] : 'latest'
          },
          {
            currentVersion: new SemVer(installed),
            allowPrerelease: allowed,
            fullChangelog: false
          },
          {
            platform,
            executor: {
              request: async ({ path }) => {
                requests.push(path)
                if (path.endsWith('.atom')) return feed
                if (path.endsWith('/latest')) return JSON.stringify({ tag_name: 'v1.1.0' })
                const suffix = platform === 'linux' ? '-linux' : ''
                if (path === `/example/app/releases/download/v${expected}/${channel}${suffix}.yml`)
                  return `version: ${expected}\nfiles: []`
                throw new Error(`Unexpected metadata request: ${path}`)
              }
            }
          }
        )
        expect((await provider.getLatestVersion()).version).toBe(expected)
        expect(requests.some((path) => path.endsWith('/latest'))).toBe(!allowed)
      }
    }
  )

  // The 1.0 cutover: stable releases publish only latest*.yml, so a beta install
  // reaches stable through the provider's latest.yml fallback.
  it.each(['win32', 'linux'])(
    'beta install moves to stable 1.0.0; stable 1.0.0 ignores a later beta (%s)',
    async (platform) => {
      vi.stubEnv('TEST_UPDATER_ARCH', 'x64')
      const suffix = platform === 'linux' ? '-linux' : ''
      const metadata = {
        '1.0.0': ['latest'],
        '1.0.0-beta.4': ['beta'],
        '1.1.0-beta.1': ['beta']
      }
      for (const [installed, allowed, channel, newest, expectedRequests] of [
        [
          '1.0.0-beta.4',
          true,
          'beta',
          '1.0.0',
          [`v1.0.0/beta${suffix}.yml`, `v1.0.0/latest${suffix}.yml`]
        ],
        ['1.0.0', false, 'latest', '1.1.0-beta.1', [`v1.0.0/latest${suffix}.yml`]]
      ]) {
        const cutoverVersions = [newest, '1.0.0', '1.0.0-beta.4', '1.0.0-beta.3'].filter(
          (version, index, all) => all.indexOf(version) === index
        )
        const cutoverFeed = `<feed>${cutoverVersions.map((version) => `<entry><title>${version}</title><link href="https://github.com/example/app/releases/tag/v${version}"/><content>Fixture notes</content></entry>`).join('')}</feed>`
        const requests = []
        const provider = new GitHubProvider(
          { provider: 'github', owner: 'example', repo: 'app', channel },
          {
            currentVersion: new SemVer(installed),
            allowPrerelease: allowed,
            fullChangelog: false
          },
          {
            platform,
            executor: {
              request: async ({ path }) => {
                if (path.endsWith('.atom')) return cutoverFeed
                if (path.endsWith('/latest')) return JSON.stringify({ tag_name: 'v1.0.0' })
                const match =
                  /\/example\/app\/releases\/download\/v([^/]+)\/(\w+)(-linux)?\.yml$/.exec(path)
                if (!match || (match[3] ?? '') !== suffix) {
                  throw new Error(`Unexpected metadata request: ${path}`)
                }
                requests.push(`v${match[1]}/${match[2]}${suffix}.yml`)
                if (metadata[match[1]]?.includes(match[2])) {
                  return `version: ${match[1]}\nfiles: []`
                }
                throw new HttpError(404, 'Not Found')
              }
            }
          }
        )
        expect((await provider.getLatestVersion()).version).toBe('1.0.0')
        expect(requests).toEqual(expectedRequests)
      }
    }
  )
})
