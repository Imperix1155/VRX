import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const probeSource = readFileSync(resolve('scripts/credential-persistence-probe.ts'), 'utf8')
const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8')
const builderFilesBlock = builderConfig.match(/^files:\r?\n((?: {2}- .*\r?\n)+)/m)?.[1]
if (!builderFilesBlock) throw new Error('missing electron-builder files block')
const builderFileEntries = builderFilesBlock.split(/\r?\n/).map((line) => line.trim())

describe('Linux credential persistence probe contract', () => {
  it('selects GNOME libsecret for both Electron processes', () => {
    const command = packageJson.scripts['test:credential-persistence-linux']
    const backendFlag = '--password-store=gnome-libsecret'

    if (!command) throw new Error('missing test:credential-persistence-linux script')

    expect(command.split(backendFlag)).toHaveLength(3)
    expect(command).toMatch(
      /electron --password-store=gnome-libsecret out\/credential-probe\/index\.js write/
    )
    expect(command).toMatch(
      /electron --password-store=gnome-libsecret out\/credential-probe\/index\.js read/
    )
  })

  it('attests the explicitly selected GNOME libsecret backend', () => {
    expect(probeSource).toMatch(/safeStorage\.getSelectedStorageBackend\(\) === 'gnome_libsecret'/)
    expect(probeSource).not.toMatch(/getSelectedStorageBackend\(\) !== 'basic_text'/)
  })

  it('keeps test-only probe artifacts out of application packages', () => {
    expect(builderFileEntries).toEqual(
      expect.arrayContaining([
        "- '!out/credential-probe/**'",
        "- '!electron-vite.credential-probe.config.ts'",
        "- '!scripts/credential-persistence-probe.ts'",
        "- '!scripts/credential-persistence-probe-contract.test.ts'"
      ])
    )
  })
})
