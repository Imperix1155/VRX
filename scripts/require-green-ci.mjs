#!/usr/bin/env node
/**
 * Release CI gate: refuse to tag or publish a commit unless it is on `main` and
 * CI's `ci-success` check passed on that exact commit.
 *
 * Usage (in release.yml, GH_TOKEN and GITHUB_REPOSITORY set):
 *   node scripts/require-green-ci.mjs <sha>
 * Waits while the check is queued or running (CI and Release start together on
 * a merge), then exits 0 on success and 1 on failure, absence or timeout.
 * Only check runs created by GitHub Actions count, so another app cannot post a
 * passing `ci-success`.
 */
import { pathToFileURL } from 'node:url'

export const CHECK_NAME = 'ci-success'
const ACTIONS_APP = 'github-actions'

/**
 * Decide from the commit's check runs. `pending` keeps waiting; anything else
 * is final. The newest Actions-owned run wins, so a successful re-run clears an
 * earlier failure and a failed re-run is not hidden by an older pass.
 */
export function ciVerdict(checkRuns) {
  const runs = checkRuns
    .filter((run) => run.name === CHECK_NAME && run.app?.slug === ACTIONS_APP)
    .sort((a, b) => Date.parse(b.started_at ?? 0) - Date.parse(a.started_at ?? 0))
  const latest = runs[0]
  if (latest === undefined) return { state: 'pending', detail: 'no ci-success run yet' }
  if (latest.status !== 'completed') return { state: 'pending', detail: latest.status }
  if (latest.conclusion === 'success') return { state: 'success', detail: latest.html_url }
  return { state: 'failure', detail: `${latest.conclusion} ${latest.html_url ?? ''}`.trim() }
}

/** Compare `main...sha`: the commit is on main when main already contains it. */
export function isOnMain(compareStatus) {
  return compareStatus === 'identical' || compareStatus === 'behind'
}

async function api(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`)
  return response.json()
}

async function main() {
  const sha = process.argv[2]
  const repo = process.env.GITHUB_REPOSITORY
  if (!sha || !/^[0-9a-f]{40}$/.test(sha) || !repo) {
    throw new Error('Usage: require-green-ci.mjs <40-char sha> (GITHUB_REPOSITORY set)')
  }
  const compare = await api(`repos/${repo}/compare/main...${sha}`)
  if (!isOnMain(compare.status)) {
    console.error(
      `::error::${sha} is not on main (${compare.status}); releases ship only main commits.`
    )
    process.exit(1)
  }
  const timeoutMs = Number(process.env.CI_GATE_TIMEOUT_MS ?? 60 * 60 * 1000)
  const pollMs = Number(process.env.CI_GATE_POLL_MS ?? 30 * 1000)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { check_runs: runs } = await api(
      `repos/${repo}/commits/${sha}/check-runs?check_name=${CHECK_NAME}&filter=all&per_page=100`
    )
    const verdict = ciVerdict(runs)
    if (verdict.state === 'success') {
      console.log(`CI passed on ${sha}: ${verdict.detail}`)
      return
    }
    if (verdict.state === 'failure') {
      console.error(`::error::CI did not pass on ${sha}: ${verdict.detail}`)
      process.exit(1)
    }
    if (Date.now() >= deadline) {
      console.error(`::error::Timed out waiting for ${CHECK_NAME} on ${sha} (${verdict.detail}).`)
      process.exit(1)
    }
    console.log(`Waiting for ${CHECK_NAME} on ${sha} (${verdict.detail})…`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`)
    process.exit(1)
  })
}
