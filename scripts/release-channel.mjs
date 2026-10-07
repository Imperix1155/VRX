import { readFileSync } from 'node:fs'

// Deliberately support only the documented stable, beta.N and rc.N tag forms.
// No dependency installation is needed in the fail-fast workflow verify job.
const [tag, suppliedVersion] = process.argv.slice(2)
const version = suppliedVersion ?? JSON.parse(readFileSync('package.json', 'utf8')).version
const match =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(beta|rc)\.(?:0|[1-9]\d*))?$/.exec(version)
if (!match || tag !== `v${version}`) {
  throw new Error('Release requires a matching vX.Y.Z, vX.Y.Z-beta.N or vX.Y.Z-rc.N tag')
}
const channel = match[1] ?? 'latest'
process.stdout.write(
  JSON.stringify({
    channel,
    prerelease: channel !== 'latest',
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
)
