import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js'
import { SemVer } from 'electron-updater/node_modules/semver/index.js'

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
})
