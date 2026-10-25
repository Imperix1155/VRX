import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function metadata(version, tag = `v${version}`) {
  return JSON.parse(
    execFileSync(process.execPath, ['scripts/release-channel.mjs', tag, version], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )
}

describe('release tag/channel contract', () => {
  it.each([
    ['1.0.0', 'latest', 'main', false],
    ['1.1.0-beta.2', 'beta', 'beta', true],
    ['1.2.0-dev.3', 'dev', 'dev', true],
    ['1.0.0-rc.1', 'rc', 'main', true]
  ])('maps %s to its actual updater assets', (version, channel, branch, prerelease) => {
    const result = metadata(version)
    expect(result).toEqual({
      channel,
      branch,
      prerelease,
      assets: [
        `vrx-${version}-setup.exe`,
        `vrx-${version}-setup.exe.blockmap`,
        `VRX-${version}.exe`,
        `vrx-${version}-x86_64.AppImage`,
        `vrx_${version}_amd64.deb`,
        `${channel}.yml`,
        `${channel}-linux.yml`
      ]
    })
  })
  it.each([
    '1.0.0-alpha.1',
    '01.0.0',
    '1.0.0-beta',
    '1.0.0-dev',
    '1.0.0-dev.01',
    '1.0.0+local',
    '1.0.0-rc.01'
  ])('rejects unsupported version %s before publication', (version) => {
    expect(() => metadata(version)).toThrow()
  })
  it('rejects mismatched tags', () => {
    expect(() => metadata('1.0.0', 'v1.0.1')).toThrow()
  })
  it('wires channel metadata into build verification and final publication', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).toContain('node scripts/release-channel.mjs')
    expect(workflow).toContain('dist/$CHANNEL-linux.yml')
    expect(workflow).toContain('node scripts/select-publish-target.mjs "$CHANNEL"')
    expect(workflow).toContain('--config "$RUNNER_TEMP/electron-builder.yml"')
    expect(workflow).not.toContain('--config.publish.channel')
    expect(workflow).toContain('prerelease:$prerelease')
    expect(workflow).not.toContain('prerelease:true')
    expect(workflow).toContain('if .channel == "latest" then "true" else "false" end')
    expect(workflow.match(/make_latest:\$make_latest/g)).toHaveLength(2)
    expect(workflow).toContain('scripts/verify-windows-update-metadata.mjs')
    expect(workflow).toContain('dist/$CHANNEL.yml')
    expect(workflow).toContain('branches: [main, beta, dev]')
    expect(workflow).toContain('main:latest|beta:beta|dev:dev')
  })

  it('runs CI on every branch and asks Dependabot to cover beta and dev', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(ci).toContain("branches:\n      - '**'")
    expect(ci).not.toMatch(/pull_request:\n\s+branches:/)
    expect(ci).toContain("github.ref != 'refs/heads/beta'")
    expect(ci).toContain("github.ref != 'refs/heads/dev'")
    const dependabot = readFileSync('.github/dependabot.yml', 'utf8')
    expect(dependabot.match(/target-branch: main/g)).toHaveLength(2)
    expect(dependabot.match(/target-branch: beta/g)).toHaveLength(2)
    expect(dependabot.match(/target-branch: dev/g)).toHaveLength(2)
  })
})

// Ask the locked builder to generate manifest tasks, using synthetic artifact
// hashes so this checks naming without running installers or publication.
describe('locked builder manifest filenames', () => {
  it.each(['1.0.0', '1.1.0-beta.2', '1.2.0-dev.3', '1.0.0-rc.1'])(
    'matches the release allowlist for %s',
    async (version) => {
      const { createUpdateInfoTasks } =
        await import('app-builder-lib/out/publish/updateInfoBuilder.js')
      const { Platform } = await import('app-builder-lib/out/core.js')
      const { Arch } = await import('builder-util')
      const { basename } = await import('node:path')
      const { channel, assets } = metadata(version)
      for (const [platform, artifact] of [
        [Platform.WINDOWS, assets[0]],
        [Platform.LINUX, assets[3]]
      ]) {
        const tasks = await createUpdateInfoTasks(
          {
            file: `/synthetic/${artifact}`,
            arch: Arch.x64,
            target: { outDir: '/synthetic' },
            updateInfo: { sha512: 'synthetic-test-hash', size: 1 },
            packager: {
              platform,
              appInfo: { version },
              config: {},
              platformSpecificBuildOptions: {},
              info: {},
              getResource: async () => null
            }
          },
          [{ provider: 'github', owner: 'example', repo: 'app', channel }]
        )
        expect(tasks).toHaveLength(1)
        expect(assets).toContain(basename(tasks[0].file))
        expect(tasks[0].info.version).toBe(version)
        expect(tasks[0].info.files[0].url).toBe(artifact)
      }
    }
  )
})
