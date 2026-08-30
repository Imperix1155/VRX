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
    expect(command).not.toContain('--no-sandbox')
    // Build output stays fully suppressed. Electron stderr is inherited into
    // CI's private diagnostic file so only an exact allowlisted assertion can
    // be surfaced by the outer workflow.
    expect(command.match(/>\/dev\/null 2>&1/g)).toHaveLength(1)
    expect(command.match(/ASSERT_[A-Z_]+/g)).toEqual([
      'ASSERT_ARGUMENTS',
      'ASSERT_PROBE_BUILD',
      'ASSERT_PROBE_EXECUTION',
      'ASSERT_PROBE_WRITE',
      'ASSERT_PROBE_READ'
    ])
    expect(command).toContain('[ ! -f "$1/.vrx-credential-persistence-probe" ]')
  })

  it('attests the explicitly selected GNOME libsecret backend', () => {
    expect(probeSource).toContain("const MARKER_NAME = '.vrx-credential-persistence-probe'")
    expect(probeSource).toMatch(/safeStorage\.getSelectedStorageBackend\(\) === 'gnome_libsecret'/)
    expect(probeSource).not.toMatch(/getSelectedStorageBackend\(\) !== 'basic_text'/)
    expect(probeSource).toContain(
      "assertProbe(!containsFixture(userDataRoot), 'ASSERT_PLAINTEXT_ABSENT')"
    )
    expect(probeSource).toContain('writeSync(2, `${label}\\n`)')
    expect(probeSource).not.toContain('process.stderr.write')
  })

  it('reports an allowlisted failure stage without printing raw probe output', () => {
    const credentialProbeStep = ciWorkflow.match(
      / {6}- name: Test Linux credential persistence across restart[\s\S]*?(?=\n {6}- name: Lint)/
    )?.[0]

    if (!credentialProbeStep) throw new Error('missing Linux credential persistence CI step')

    expect(ciWorkflow).toContain('os: [ubuntu-24.04, windows-latest]')
    expect(ciWorkflow.match(/matrix\.os == 'ubuntu-24\.04'/g)).toHaveLength(2)
    expect(ciWorkflow).not.toContain("matrix.os == 'ubuntu-latest'")
    expect(credentialProbeStep).toContain(
      'diagnostic_file=$(mktemp "${RUNNER_TEMP}/vrx-credential-probe-diagnostic.XXXXXX")'
    )
    expect(credentialProbeStep).toContain('chmod 600 "$diagnostic_file"')
    expect(credentialProbeStep).toContain(
      'keyring_data_dir=$(mktemp -d "${RUNNER_TEMP}/vrx-keyring-data.XXXXXX")'
    )
    expect(credentialProbeStep).toContain('chmod 700 "$runtime_dir" "$keyring_data_dir"')
    expect(credentialProbeStep).toContain('export XDG_DATA_HOME="$keyring_data_dir"')
    expect(credentialProbeStep).toContain(
      'expected_electron_binary="$GITHUB_WORKSPACE/node_modules/electron/dist/electron"'
    )
    expect(credentialProbeStep).toContain(
      'if ! electron_binary=$(realpath -- "$expected_electron_binary" 2>/dev/null); then'
    )
    expect(credentialProbeStep).toMatch(
      /if \[ "\$electron_binary" != "\$expected_electron_binary" \] \|\| \\\n\s+\[ ! -f "\$electron_binary" \] \|\| \[ -L "\$electron_binary" \] \|\| \\\n\s+\[ ! -x "\$electron_binary" \]; then/
    )
    expect(credentialProbeStep).toContain('profile_name=vrx-electron-ci')
    expect(credentialProbeStep).toContain('profile_path="/etc/apparmor.d/$profile_name"')
    expect(credentialProbeStep).toContain('cleanup_status=0')
    expect(credentialProbeStep).toContain("trap 'cleanup || true' EXIT")
    expect(credentialProbeStep).toContain('if sudo test -e "$profile_path" >/dev/null 2>&1; then')
    expect(credentialProbeStep).toContain('profile_created=1')
    expect(credentialProbeStep).toContain('profile %s "%s" flags=(unconfined) {\\n  userns,\\n}\\n')
    expect(credentialProbeStep).toContain('sudo tee "$profile_path" >/dev/null 2>&1')
    expect(credentialProbeStep).toContain('sudo apparmor_parser -r "$profile_path" >/dev/null 2>&1')
    expect(credentialProbeStep).toContain(
      'sudo apparmor_parser -R "$profile_path" >/dev/null 2>&1 || cleanup_status=1'
    )
    expect(credentialProbeStep).toContain(
      'sudo rm -f -- "$profile_path" >/dev/null 2>&1 || cleanup_status=1'
    )
    expect(credentialProbeStep).toContain(
      'rm -rf -- "$runtime_dir" "$user_data_dir" "$keyring_data_dir" "$diagnostic_file" >/dev/null 2>&1 || cleanup_status=1'
    )
    expect(credentialProbeStep).toContain('return "$cleanup_status"')
    for (const label of [
      'ASSERT_ELECTRON_BINARY_RESOLVE',
      'ASSERT_ELECTRON_BINARY_VALIDATE',
      'ASSERT_ELECTRON_APPARMOR_PROFILE_EXISTS',
      'ASSERT_ELECTRON_APPARMOR_PROFILE_WRITE',
      'ASSERT_ELECTRON_APPARMOR_PROFILE_LOAD'
    ]) {
      expect(credentialProbeStep.match(new RegExp(label, 'g'))).toHaveLength(1)
    }
    for (const setupGuard of [
      /if ! electron_binary=\$\(realpath -- "\$expected_electron_binary" 2>\/dev\/null\); then\n\s+printf '%s\\n' ASSERT_ELECTRON_BINARY_RESOLVE >&2\n\s+exit 1\n\s+fi/,
      /if \[ "\$electron_binary" != "\$expected_electron_binary" \] \|\| \\\n\s+\[ ! -f "\$electron_binary" \] \|\| \[ -L "\$electron_binary" \] \|\| \\\n\s+\[ ! -x "\$electron_binary" \]; then\n\s+printf '%s\\n' ASSERT_ELECTRON_BINARY_VALIDATE >&2\n\s+exit 1\n\s+fi/,
      /if sudo test -e "\$profile_path" >\/dev\/null 2>&1; then\n\s+printf '%s\\n' ASSERT_ELECTRON_APPARMOR_PROFILE_EXISTS >&2\n\s+exit 1\n\s+fi/,
      /sudo tee "\$profile_path" >\/dev\/null 2>&1; then\n\s+printf '%s\\n' ASSERT_ELECTRON_APPARMOR_PROFILE_WRITE >&2\n\s+exit 1\n\s+fi/,
      /if ! sudo apparmor_parser -r "\$profile_path" >\/dev\/null 2>&1; then\n\s+printf '%s\\n' ASSERT_ELECTRON_APPARMOR_PROFILE_LOAD >&2\n\s+exit 1\n\s+fi/
    ]) {
      expect(credentialProbeStep).toMatch(setupGuard)
    }
    expect(credentialProbeStep).not.toContain('ASSERT_ELECTRON_APPARMOR_SETUP')
    expect(credentialProbeStep).toContain('ASSERT_LINUX_CREDENTIAL_PROBE_CLEANUP')
    expect(credentialProbeStep).not.toContain('ASSERT_ELECTRON_APPARMOR_CLEANUP')
    expect(credentialProbeStep).toMatch(
      /if ! cleanup; then\n\s+printf '%s\\n' ASSERT_LINUX_CREDENTIAL_PROBE_CLEANUP >&2\n\s+exit 1\n\s+fi\n\s+trap - EXIT/
    )
    expect(credentialProbeStep.indexOf('if sudo test -e "$profile_path"')).toBeLessThan(
      credentialProbeStep.indexOf('profile_created=1')
    )
    expect(credentialProbeStep.indexOf('cleanup() {')).toBeLessThan(
      credentialProbeStep.indexOf("trap 'cleanup || true' EXIT")
    )
    expect(credentialProbeStep.indexOf("trap 'cleanup || true' EXIT")).toBeLessThan(
      credentialProbeStep.indexOf('profile_created=1')
    )
    expect(credentialProbeStep.indexOf('sudo apparmor_parser -R "$profile_path"')).toBeLessThan(
      credentialProbeStep.indexOf('sudo rm -f -- "$profile_path"')
    )
    expect(credentialProbeStep.indexOf('profile_created=1')).toBeLessThan(
      credentialProbeStep.indexOf('sudo tee "$profile_path"')
    )
    expect(credentialProbeStep.indexOf('sudo apparmor_parser -r "$profile_path"')).toBeLessThan(
      credentialProbeStep.indexOf('probe_exit=0')
    )
    expect(credentialProbeStep.indexOf('probe_exit=0')).toBeLessThan(
      credentialProbeStep.indexOf('if ! cleanup; then')
    )
    expect(credentialProbeStep).not.toContain('--no-sandbox')
    expect(credentialProbeStep).not.toContain('apparmor_restrict_unprivileged_userns')
    expect(credentialProbeStep).not.toContain('chmod 4755')
    expect(credentialProbeStep).not.toContain('chrome-sandbox')
    expect(credentialProbeStep).toContain(
      'rm -rf -- "$runtime_dir" "$user_data_dir" "$keyring_data_dir" "$diagnostic_file"'
    )
    expect(credentialProbeStep).toContain('"$diagnostic_file" >/dev/null 2>&1 || probe_exit=$?')
    expect(credentialProbeStep).toContain('bash -euo pipefail -c')
    expect(credentialProbeStep).toContain('2>\\"\\$2\\"')
    expect(credentialProbeStep).toContain('bash "$1" "$probe_stage_file"')
    expect(credentialProbeStep).not.toContain('2>"$probe_stage_file"')
    expect(credentialProbeStep).toContain('grep -Fxq "$allowed_label" "$diagnostic_file"')
    expect(credentialProbeStep).toContain('printf \'%s\\n\' "$failure_label" >&2')
    expect(credentialProbeStep).toContain('probe_exit=0')
    expect(credentialProbeStep).toContain('timeout --kill-after=10s 90s dbus-run-session')
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
      'ASSERT_LINUX_PLATFORM',
      'ASSERT_USER_DATA_ROOT',
      'ASSERT_PROBE_MARKER',
      'ASSERT_ENCRYPTION_AVAILABLE',
      'ASSERT_SECURE_BACKEND',
      'ASSERT_CREDENTIAL_SAVE',
      'ASSERT_PLAINTEXT_ABSENT',
      'ASSERT_CREDENTIAL_READ',
      'ASSERT_CREDENTIAL_CLEAR',
      'ASSERT_ELECTRON_STARTUP_SANDBOX',
      'ASSERT_ELECTRON_STARTUP_DISPLAY',
      'ASSERT_ELECTRON_STARTUP_SHARED_LIBRARY',
      'ASSERT_ELECTRON_STARTUP_LAUNCHER',
      'ASSERT_ELECTRON_STARTUP_SIGNAL',
      'ASSERT_ELECTRON_STARTUP_OTHER',
      'ASSERT_PROBE_EXECUTION',
      'ASSERT_PROBE_WRITE',
      'ASSERT_PROBE_READ'
    ]) {
      expect(credentialProbeStep).toContain(label)
    }
    expect(credentialProbeStep.indexOf('ASSERT_SECURE_BACKEND')).toBeLessThan(
      credentialProbeStep.indexOf('ASSERT_PROBE_WRITE')
    )
    expect(credentialProbeStep.indexOf('ASSERT_CREDENTIAL_READ')).toBeLessThan(
      credentialProbeStep.indexOf('ASSERT_PROBE_READ')
    )
    expect(credentialProbeStep.indexOf('ASSERT_CREDENTIAL_CLEAR')).toBeLessThan(
      credentialProbeStep.indexOf('ASSERT_ELECTRON_STARTUP_SANDBOX')
    )
    expect(credentialProbeStep.indexOf('ASSERT_ELECTRON_STARTUP_SIGNAL')).toBeLessThan(
      credentialProbeStep.indexOf('grep -Fxq ASSERT_PROBE_EXECUTION')
    )
    expect(credentialProbeStep).toMatch(
      /if \[ "\$failure_label" = ASSERT_LINUX_CREDENTIAL_PROBE \]; then[\s\S]*?failure_label=ASSERT_ELECTRON_STARTUP_OTHER\n\s+fi\n\s+fi\n\s+;;/
    )
    expect(credentialProbeStep).not.toMatch(/\bgrep\s+-(?![A-Za-z]*q)/)
  })

  it('classifies fixed native Electron startup signatures without exposing them', () => {
    const patterns = {
      sandbox:
        'The SUID sandbox helper binary (was found|is missing)|No usable sandbox!|Failed to move to new (PID )?namespace|zygote_host_impl_linux\\.cc\\([^)]*\\).*Check failed',
      display: 'Missing X server or \\$DISPLAY|Unable to open X display|cannot open display',
      sharedLibrary:
        'error while loading shared libraries: .*: cannot open shared object file|symbol lookup error:|version .* not found .*required by',
      launcher:
        'node_modules/(\\.bin/electron|electron/dist/electron).*(Permission denied|not found|Exec format error)|Cannot find module .*(out/credential-probe/index\\.js|node_modules/electron/cli\\.js)'
    }

    for (const pattern of Object.values(patterns)) {
      expect(ciWorkflow).toContain(`'${pattern}'`)
    }
    expect(new RegExp(patterns.sandbox, 'i').test('FATAL: No usable sandbox!')).toBe(true)
    expect(new RegExp(patterns.display, 'i').test('Missing X server or $DISPLAY')).toBe(true)
    expect(
      new RegExp(patterns.sharedLibrary, 'i').test(
        'error while loading shared libraries: libgtk-3.so.0: cannot open shared object file'
      )
    ).toBe(true)
    expect(new RegExp(patterns.launcher, 'i').test('./node_modules/.bin/electron: not found')).toBe(
      true
    )
    expect(
      new RegExp(patterns.launcher, 'i').test(
        "Error: Cannot find module '/runner/work/VRX/VRX/out/credential-probe/index.js'"
      )
    ).toBe(true)
    expect(
      new RegExp(patterns.launcher, 'i').test(
        'Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory'
      )
    ).toBe(false)
    expect(
      new RegExp(patterns.launcher, 'i').test(
        'libEGL warning: failed to open /dev/dri/card0: Permission denied'
      )
    ).toBe(false)
    expect(
      new RegExp(patterns.sandbox, 'i').test('InitializeSandbox() called with multiple threads')
    ).toBe(false)
    expect(ciWorkflow).toContain("grep -Fqi -- 'exited with signal'")
  })

  it('keeps the outer single-quoted keyring script intact through the probe command', () => {
    const keyringScript = ciWorkflow.match(
      /dbus-run-session -- bash -euo pipefail -c '\r?\n([\s\S]*?)\r?\n {10}' bash/
    )?.[1]

    if (!keyringScript) throw new Error('missing nested keyring script')

    expect(keyringScript).toContain('xvfb-run --auto-servernum')
    expect(keyringScript).not.toContain("'")
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
