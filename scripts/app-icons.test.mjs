import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const read = (name) => readFileSync(resolve(root, name))
const pngSize = (buffer) => {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(buffer[24]).toBe(8)
  expect(buffer[25]).toBe(6)
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
}

describe('native app icon assets', () => {
  it('keeps every generated asset reproducible from the approved SVG sources', () => {
    expect(
      execFileSync(process.execPath, ['scripts/generate-app-icons.mjs', '--check'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 15000
      })
    ).toBe('APP_ICONS_CURRENT\n')
  })

  it('provides exact Windows frames with non-overlapping PNG payloads', () => {
    const data = read('build/icon.ico')
    expect(data.readUInt16LE(0)).toBe(0)
    expect(data.readUInt16LE(2)).toBe(1)
    const count = data.readUInt16LE(4)
    const sizes = []
    let end = 6 + count * 16
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16
      const width = data[entry] || 256
      const height = data[entry + 1] || 256
      const length = data.readUInt32LE(entry + 8)
      const offset = data.readUInt32LE(entry + 12)
      expect(offset).toBe(end)
      expect(length).toBeGreaterThan(0)
      expect(data.readUInt16LE(entry + 4)).toBe(1)
      expect(data.readUInt16LE(entry + 6)).toBe(32)
      end = offset + length
      expect(end).toBeLessThanOrEqual(data.length)
      expect(pngSize(data.subarray(offset, end))).toEqual([width, height])
      sizes.push(width)
    }
    expect(end).toBe(data.length)
    expect(sizes).toEqual([16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256])
    expect(read('resources/icon.ico')).toEqual(data)
  })

  it('provides valid macOS chunks including the native and Retina small sizes', () => {
    const data = read('build/icon.icns')
    expect(data.toString('ascii', 0, 4)).toBe('icns')
    expect(data.readUInt32BE(4)).toBe(data.length)
    const expected = {
      icp4: 16,
      icp5: 32,
      icp6: 64,
      ic07: 128,
      ic08: 256,
      ic09: 512,
      ic10: 1024,
      ic11: 32,
      ic12: 64,
      ic13: 256,
      ic14: 512
    }
    const seen = []
    let offset = 8
    while (offset < data.length) {
      const type = data.toString('ascii', offset, offset + 4)
      const length = data.readUInt32BE(offset + 4)
      expect(length).toBeGreaterThan(8)
      expect(offset + length).toBeLessThanOrEqual(data.length)
      expect(pngSize(data.subarray(offset + 8, offset + length))).toEqual([
        expected[type],
        expected[type]
      ])
      seen.push(type)
      offset += length
    }
    expect(offset).toBe(data.length)
    expect(seen.sort()).toEqual(Object.keys(expected).sort())
  })

  it('keeps the Linux and runtime master identical with dedicated tray representations', () => {
    const master = read('build/icon.png')
    expect(pngSize(master)).toEqual([512, 512])
    expect(read('resources/icon.png')).toEqual(master)
    for (const [name, size] of [
      ['icon-16.png', 16],
      ['icon-16@2x.png', 32],
      ['icon-24.png', 24],
      ['icon-24@2x.png', 48]
    ])
      expect(pngSize(read(`resources/${name}`))).toEqual([size, size])
  })

  it('points each package type at its native icon format', () => {
    const config = load(read('electron-builder.yml').toString('utf8'))
    const base = config.directories.buildResources
    expect(read(`${base}/${config.win.icon}`).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]))
    expect(read(`${base}/${config.mac.icon}`).toString('ascii', 0, 4)).toBe('icns')
    expect(pngSize(read(`${base}/${config.linux.icon}`))).toEqual([512, 512])
  })
})
