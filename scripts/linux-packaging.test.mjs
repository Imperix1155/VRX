import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DebugLogger, getArtifactArchName, Arch } from 'builder-util'
import { satisfies } from 'semver'
import { LinuxTargetHelper } from 'app-builder-lib/out/targets/LinuxTargetHelper.js'
import { loadConfig } from 'app-builder-lib/out/util/config/load.js'
import { validateConfiguration } from 'app-builder-lib/out/util/config/config.js'
import { expandMacro } from 'app-builder-lib/out/util/macroExpander.js'

const projectDir = resolve(import.meta.dirname, '..')
const packageMetadata = JSON.parse(await readFile(resolve(projectDir, 'package.json'), 'utf8'))
const releaseWorkflow = await readFile(resolve(projectDir, '.github/workflows/release.yml'), 'utf8')
const updaterMetadata = JSON.parse(
  await readFile(resolve(projectDir, 'node_modules/electron-updater/package.json'), 'utf8')
)
const { result: config } = await loadConfig({
  projectDir,
  packageKey: 'build',
  configFilename: 'electron-builder'
})

await validateConfiguration(config, new DebugLogger(false))

function desktopEntryMap(entry) {
  return Object.fromEntries(
    entry
      .split('\n')
      .filter((line) => line && !line.startsWith('['))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
}

function createLinuxTargetHelper() {
  const appInfo = {
    productName: config.productName,
    sanitizedProductName: config.productName,
    description: packageMetadata.description
  }
  const packager = {
    appInfo,
    executableName: packageMetadata.name,
    fileAssociations: [],
    platformSpecificBuildOptions: config.linux,
    config: { ...config, protocols: [] },
    info: { metadata: packageMetadata }
  }
  return new LinuxTargetHelper(packager)
}

describe('Linux packaging contract (VRX-101)', () => {
  it('provides the project URL required by the deb package metadata', () => {
    expect(new URL(packageMetadata.homepage).href).toBe('https://github.com/Imperix1155/VRX')
  })

  it('builds a searchable desktop entry whose filename and WM class match Electron', async () => {
    const helper = createLinuxTargetHelper()
    const entry = desktopEntryMap(await helper.computeDesktopEntry(config.linux))

    expect(helper.getDesktopFileName()).toBe('com.imperix.vrx')
    expect(entry).toMatchObject({
      Name: 'VRX',
      GenericName: 'Social VR Companion',
      Comment: 'VRX — Social VR companion for VRChat + ChilloutVR',
      Icon: 'vrx',
      StartupWMClass: 'com.imperix.vrx',
      StartupNotify: 'true',
      Categories: 'Network;',
      Keywords: 'VRChat;ChilloutVR;Social;Friends;'
    })
  })

  it('uses a real 512px RGBA PNG as the explicit Linux icon source', async () => {
    const iconPath = resolve(projectDir, config.directories.buildResources, config.linux.icon)
    const icon = await readFile(iconPath)

    expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(icon.readUInt32BE(16)).toBe(512)
    expect(icon.readUInt32BE(20)).toBe(512)
    expect(icon[25]).toBe(6)
  })

  it('names the x64 AppImage with product, version, and architecture', () => {
    const arch = getArtifactArchName(Arch.x64, 'AppImage')
    const artifactName = expandMacro(
      config.appImage.artifactName,
      arch,
      {
        name: packageMetadata.name,
        version: packageMetadata.version,
        productName: config.productName,
        sanitizedProductName: config.productName
      },
      { ext: 'AppImage' }
    )

    expect(artifactName).toBe(`vrx-${packageMetadata.version}-x86_64.AppImage`)
  })

  it('keeps AppImage publishing compatible with the installed updater', () => {
    expect(config.linux.target).toContain('AppImage')
    expect(config.publish).toMatchObject({ provider: 'github', owner: 'Imperix1155', repo: 'VRX' })
    expect(satisfies(updaterMetadata.version, config.linux.electronUpdaterCompatibility)).toBe(true)
  })

  it('publishes only a draft whose release assets exactly match the allowlist', () => {
    expect(releaseWorkflow).toContain('select(($exp - .assets) == [] and (.assets - $exp) == [])')
  })
})
