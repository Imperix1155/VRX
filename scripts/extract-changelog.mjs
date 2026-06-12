#!/usr/bin/env node
/**
 * Extract one version's section from CHANGELOG.md (VRX-126).
 *
 * Usage: node scripts/extract-changelog.mjs 0.1.0
 * Prints the body of the `## [0.1.0] ...` heading up to the next `## [` heading.
 * Prints nothing (exit 0) if the section is absent, so the release pipeline can
 * fall back to GitHub's auto-generated notes rather than ship an empty release.
 *
 * Fenced code blocks are tracked, so a `## [...]` line inside a ``` example is
 * not mistaken for the next section boundary.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HEADING = /^##\s+\[([^\]]+)\]/
const FENCE = /^\s*(```|~~~)/

/** Return the trimmed body of the `## [version]` section, or '' if not found. */
export function extractSection(changelog, version) {
  const lines = changelog.split('\n')
  let start = -1
  let end = lines.length
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const m = lines[i].match(HEADING)
    if (!m) continue

    if (start === -1) {
      if (m[1] === version) start = i + 1
    } else {
      end = i
      break
    }
  }

  if (start === -1) return ''
  return lines.slice(start, end).join('\n').trim()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (!version) {
    process.stderr.write('usage: extract-changelog.mjs <version>\n')
    process.exit(2)
  }
  const changelogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')
  process.stdout.write(extractSection(readFileSync(changelogPath, 'utf8'), version))
}
