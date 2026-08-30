import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const probeSource = readFileSync(resolve('scripts/credential-persistence-probe.ts'), 'utf8')

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
})
