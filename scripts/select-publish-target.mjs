#!/usr/bin/env node
/**
 * Write an electron-builder config that publishes exactly one channel.
 *
 * electron-builder.yml lists latest, beta, and dev. Publishing that array
 * would upload every channel file for one build, so a dev release could
 * offer itself to beta. This script copies the matching target (rc is the
 * latest target with its channel renamed) into a temp config whose publish
 * field is that single object.
 *
 * Usage: node scripts/select-publish-target.mjs <latest|beta|dev|rc> <dest.yml>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { load, dump } from 'js-yaml'

const PROVIDER = {
  provider: 'github',
  owner: 'Imperix1155',
  repo: 'VRX',
  releaseType: 'draft'
}
const STANDING_CHANNELS = ['latest', 'beta', 'dev']

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function selectPublishTarget(config, channel) {
  if (!STANDING_CHANNELS.includes(channel) && channel !== 'rc') {
    throw new Error(`Unsupported publish channel ${String(channel)}`)
  }
  const publish = config?.publish
  if (!Array.isArray(publish)) {
    throw new Error('electron-builder.yml publish must list latest, beta, and dev')
  }
  if (publish.length !== STANDING_CHANNELS.length) {
    throw new Error('electron-builder.yml publish must list exactly latest, beta, and dev')
  }
  const byChannel = new Map()
  for (const target of publish) {
    if (!isRecord(target) || typeof target.channel !== 'string' || byChannel.has(target.channel)) {
      throw new Error('publish targets need distinct channel names')
    }
    for (const [key, expected] of Object.entries(PROVIDER)) {
      if (target[key] !== expected) {
        throw new Error(`publish target ${target.channel} must keep ${key}=${expected}`)
      }
    }
    byChannel.set(target.channel, target)
  }
  for (const name of STANDING_CHANNELS) {
    if (!byChannel.has(name)) throw new Error(`publish is missing the ${name} channel`)
  }
  if (channel === 'rc') return { ...byChannel.get('latest'), channel: 'rc' }
  return { ...byChannel.get(channel) }
}

export function configForChannel(config, channel) {
  return { ...config, publish: selectPublishTarget(config, channel) }
}

function main() {
  const [channel, dest] = process.argv.slice(2)
  if (!channel || !dest) {
    throw new Error('Usage: select-publish-target.mjs <latest|beta|dev|rc> <dest.yml>')
  }
  const config = load(readFileSync('electron-builder.yml', 'utf8'))
  writeFileSync(dest, dump(configForChannel(config, channel)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exit(1)
  }
}
