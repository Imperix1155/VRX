import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { configForChannel, selectPublishTarget } from './select-publish-target.mjs'

const builder = load(await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8'))

describe('select publish target', () => {
  it('keeps one GitHub draft target per standing channel', () => {
    expect(builder.publish.map((target) => target.channel)).toEqual(['latest', 'beta', 'dev'])
    for (const channel of ['latest', 'beta', 'dev']) {
      const target = selectPublishTarget(builder, channel)
      expect(target).toMatchObject({
        provider: 'github',
        owner: 'Imperix1155',
        repo: 'VRX',
        channel,
        releaseType: 'draft'
      })
      expect(configForChannel(builder, channel).publish).toEqual(target)
      expect(Array.isArray(configForChannel(builder, channel).publish)).toBe(false)
    }
  })

  it('builds an rc target from latest without adding rc to the standing list', () => {
    const rc = selectPublishTarget(builder, 'rc')
    expect(rc).toEqual({ ...selectPublishTarget(builder, 'latest'), channel: 'rc' })
    expect(builder.publish.map((target) => target.channel)).not.toContain('rc')
  })

  it('rejects a channel that is not published on its own', () => {
    expect(() => selectPublishTarget(builder, 'nightly')).toThrow(/Unsupported publish channel/)
    expect(() => selectPublishTarget({ publish: { provider: 'github' } }, 'latest')).toThrow(
      /must list/
    )
  })

  it('writes a config whose publish field is the one selected target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vrx-publish-target-'))
    const dest = join(directory, 'electron-builder.yml')
    execFileSync(process.execPath, ['scripts/select-publish-target.mjs', 'dev', dest], {
      encoding: 'utf8'
    })
    const written = load(await readFile(dest, 'utf8'))
    expect(written.publish).toMatchObject({ channel: 'dev', repo: 'VRX', releaseType: 'draft' })
    expect(written.productName).toBe(builder.productName)
  })
})
