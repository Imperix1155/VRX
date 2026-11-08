#!/usr/bin/env node
// Checks that every relative Markdown link in the committed docs points at a
// file or folder that exists, and that every `#anchor` matches a heading in
// the target file. External links (http, https, mailto) are not fetched.
//
//   npm run docs:links          # print broken links, exit 1 if any
//
// scripts/check-doc-links.test.mjs runs the same check inside `npm test`, so
// CI catches a link that a rename or a split left behind.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
export function headingSlug(text) {
  let plain = text.trim().toLowerCase()
  // Repeat until stable so nested or overlapping tags leave nothing behind.
  for (let previous = ''; previous !== plain;) {
    previous = plain
    plain = plain.replace(/<[^>]*>/g, '')
  }
  return plain.replace(/[^\p{L}\p{N}\- _]/gu, '').replace(/ /g, '-')
}

/** Every anchor a Markdown file defines, with GitHub's -1, -2 duplicate suffixes. */
export function anchorsOf(markdown) {
  const anchors = new Set()
  const seen = new Map()
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/)
    if (heading) {
      const base = headingSlug(heading[1])
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      anchors.add(count === 0 ? base : `${base}-${count}`)
    }
    for (const html of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(html[1])
  }
  return anchors
}

/** Inline link targets outside code fences and code spans. */
export function linkTargets(markdown) {
  const targets = []
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) continue
    const prose = line.replace(/`[^`]*`/g, '``')
    for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) targets.push(match[1])
  }
  return targets
}

function trackedMarkdown() {
  return execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

/** Why one link target from `file` is broken, or null when it resolves. */
function linkProblem(file, target, anchorsFor) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  const [rawPath, anchor] = target.split('#')
  const path = rawPath ? normalize(join(dirname(file), decodeURIComponent(rawPath))) : file
  if (!existsSync(join(ROOT, path))) return 'missing file'
  const checksAnchor = anchor && path.endsWith('.md') && statSync(join(ROOT, path)).isFile()
  if (checksAnchor && !anchorsFor(path).has(decodeURIComponent(anchor))) return 'missing heading'
  return null
}

/** Returns `{ file, target, problem }` for each broken relative link. */
export function findBrokenLinks(files = trackedMarkdown()) {
  const anchorCache = new Map()
  const anchorsFor = (path) => {
    if (!anchorCache.has(path))
      anchorCache.set(path, anchorsOf(readFileSync(join(ROOT, path), 'utf8')))
    return anchorCache.get(path)
  }
  return files.flatMap((file) =>
    linkTargets(readFileSync(join(ROOT, file), 'utf8')).flatMap((target) => {
      const problem = linkProblem(file, target, anchorsFor)
      return problem ? [{ file, target, problem }] : []
    })
  )
}

// Node resolves the entry module through symlinks, so compare real paths.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const broken = findBrokenLinks()
  for (const { file, target, problem } of broken) console.log(`${file}: ${target} (${problem})`)
  if (broken.length) {
    console.log(`\n${broken.length} broken link(s).`)
    process.exit(1)
  }
  console.log('All relative Markdown links resolve.')
}
