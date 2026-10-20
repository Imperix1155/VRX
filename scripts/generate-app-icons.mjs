import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const svg = new Map(
  await Promise.all(
    ['icon.svg', 'icon-16.svg', 'icon-24.svg'].map(async (name) => [
      name,
      await readFile(resolve(root, 'build', name), 'utf8')
    ])
  )
)
const cache = new Map()

function png(size, source = size === 16 ? 'icon-16.svg' : size <= 24 ? 'icon-24.svg' : 'icon.svg') {
  const key = `${source}:${size}`
  if (!cache.has(key)) {
    cache.set(
      key,
      new Resvg(svg.get(source), {
        fitTo: { mode: 'width', value: size },
        font: { loadSystemFonts: false }
      })
        .render()
        .asPng()
    )
  }
  return cache.get(key)
}

// Modern Windows accepts PNG frames in an ICO. Each entry keeps its exact size
// so the shell need not reduce the 256px master for the ordinary taskbar sizes.
function ico(sizes) {
  const header = Buffer.alloc(6 + sizes.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  const frames = sizes.map((size, index) => {
    const frame = png(size)
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += frame.length
    return frame
  })
  return Buffer.concat([header, ...frames])
}

function icns() {
  const chunks = [
    ['icp4', 16, 'icon-16.svg'],
    ['icp5', 32, 'icon.svg'],
    ['icp6', 64, 'icon.svg'],
    ['ic07', 128, 'icon.svg'],
    ['ic08', 256, 'icon.svg'],
    ['ic09', 512, 'icon.svg'],
    ['ic10', 1024, 'icon.svg'],
    ['ic11', 32, 'icon-16.svg'],
    ['ic12', 64, 'icon.svg'],
    ['ic13', 256, 'icon.svg'],
    ['ic14', 512, 'icon.svg']
  ].map(([type, size, source]) => {
    const frame = png(size, source)
    const header = Buffer.alloc(8)
    header.write(type)
    header.writeUInt32BE(frame.length + 8, 4)
    return Buffer.concat([header, frame])
  })
  const header = Buffer.alloc(8)
  header.write('icns')
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

const windows = ico([16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256])
const outputs = new Map([
  ['build/icon.ico', windows],
  ['build/icon.icns', icns()],
  ['build/icon.png', png(512)],
  ['resources/icon.png', png(512)],
  ['resources/icon.ico', windows],
  ['resources/icon-16.png', png(16)],
  ['resources/icon-16@2x.png', png(32, 'icon-16.svg')],
  ['resources/icon-24.png', png(24)],
  ['resources/icon-24@2x.png', png(48, 'icon-24.svg')]
])

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('Usage: node scripts/generate-app-icons.mjs [--check]')
}
const checking = args[0] === '--check'
for (const [name, expected] of outputs) {
  const file = resolve(root, name)
  if (checking) {
    const actual = await readFile(file)
    if (!actual.equals(expected)) throw new Error(`${name} is stale; run npm run icons:generate`)
  } else {
    await writeFile(file, expected)
  }
}
process.stdout.write(checking ? 'APP_ICONS_CURRENT\n' : 'APP_ICONS_GENERATED\n')
