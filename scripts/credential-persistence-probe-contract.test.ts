import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const probeSource = readFileSync(resolve('scripts/credential-persistence-probe.ts'), 'utf8')
const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8')
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
    expect(command.match(/>\/dev\/null 2>&1/g)).toHaveLength(3)
    expect(command.match(/ASSERT_[A-Z_]+/g)).toEqual([
      'ASSERT_ARGUMENTS',
      'ASSERT_PROBE_BUILD',
      'ASSERT_PROBE_WRITE',
      'ASSERT_PROBE_READ'
    ])
  })

  it('attests the explicitly selected GNOME libsecret backend', () => {
    expect(probeSource).toMatch(/safeStorage\.getSelectedStorageBackend\(\) === 'gnome_libsecret'/)
    expect(probeSource).not.toMatch(/getSelectedStorageBackend\(\) !== 'basic_text'/)
  })

  it('reports an allowlisted failure stage without printing raw probe output', () => {
    const credentialProbeStep = ciWorkflow.match(
      / {6}- name: Test Linux credential persistence across restart[\s\S]*?(?=\n {6}- name: Lint)/
    )?.[0]

    if (!credentialProbeStep) throw new Error('missing Linux credential persistence CI step')

    expect(credentialProbeStep).toContain(
      'diagnostic_file=$(mktemp "${RUNNER_TEMP}/vrx-credential-probe-diagnostic.XXXXXX")'
    )
    expect(credentialProbeStep).toContain(
      'keyring_data_dir=$(mktemp -d "${RUNNER_TEMP}/vrx-keyring-data.XXXXXX")'
    )
    expect(credentialProbeStep).toContain('chmod 700 "$runtime_dir" "$keyring_data_dir"')
    expect(credentialProbeStep).toContain('export XDG_DATA_HOME="$keyring_data_dir"')
    expect(credentialProbeStep).toContain(
      'rm -rf -- "$runtime_dir" "$user_data_dir" "$keyring_data_dir" "$diagnostic_file"'
    )
    expect(credentialProbeStep).toContain('"$diagnostic_file" >/dev/null 2>&1 || probe_exit=$?')
    expect(credentialProbeStep).toContain('2>"$probe_stage_file"')
    expect(credentialProbeStep).toContain('grep -Fxq "$allowed_label" "$diagnostic_file"')
    expect(credentialProbeStep).toContain('printf \'%s\\n\' "$failure_label" >&2')
    expect(credentialProbeStep).toContain('probe_exit=0')
    expect(credentialProbeStep).toContain('124|137)')
    expect(credentialProbeStep).toContain('ASSERT_LINUX_CREDENTIAL_PROBE_TIMEOUT')
    expect(credentialProbeStep).not.toMatch(
      /(?:cat|head|tail|less|more|sed|awk)\s+[^\n]*\$diagnostic_file/
    )

    for (const label of [
      'ASSERT_KEYRING_LOGIN',
      'ASSERT_KEYRING_LOGIN_ENV',
      'ASSERT_KEYRING_START',
      'ASSERT_KEYRING_START_ENV',
      'ASSERT_ARGUMENTS',
      'ASSERT_PROBE_BUILD',
      'ASSERT_PROBE_WRITE',
      'ASSERT_PROBE_READ'
    ]) {
      expect(credentialProbeStep).toContain(label)
    }
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
