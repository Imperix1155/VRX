import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CACHE_ADVISORY = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp'
const LEGACY_ESBUILD_ADVISORY = 'https://github.com/advisories/GHSA-g7r4-m6w7-qqqr'
const CACHE_EXCEPTION_EXPIRES = Date.parse('2026-10-31T00:00:00Z')
const severities = ['info', 'low', 'moderate', 'high', 'critical']
const highRisk = (severity) => severity === 'high' || severity === 'critical'

function validateEntries(entries, all) {
  for (const [, entry] of entries) {
    if (!entry || !severities.includes(entry.severity) || !Array.isArray(entry.via)) {
      throw new Error('Invalid npm audit vulnerability')
    }
    for (const advisory of entry.via) {
      if (typeof advisory === 'string') {
        if (!all[advisory]) throw new Error('Missing cascaded advisory')
      } else if (
        !advisory ||
        !severities.includes(advisory.severity) ||
        typeof advisory.url !== 'string' ||
        severities.indexOf(advisory.severity) > severities.indexOf(entry.severity)
      ) {
        throw new Error('Invalid npm audit advisory')
      }
    }
  }
}

function vulnerabilities(report) {
  if (
    report?.auditReportVersion !== 2 ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !report.metadata?.vulnerabilities
  ) {
    throw new Error('Invalid or failed npm audit report')
  }
  const entries = Object.entries(report.vulnerabilities)
  validateEntries(entries, report.vulnerabilities)
  for (const severity of severities) {
    if (
      report.metadata.vulnerabilities[severity] !==
      entries.filter(([, entry]) => entry.severity === severity).length
    ) {
      throw new Error('Inconsistent npm audit severity counts')
    }
  }
  if (report.metadata.vulnerabilities.total !== entries.length) {
    throw new Error('Inconsistent npm audit total')
  }
  function reachesAdvisory(name, seen = new Set()) {
    if (seen.has(name)) return false
    seen.add(name)
    return report.vulnerabilities[name].via.some((advisory) =>
      typeof advisory === 'string' ? reachesAdvisory(advisory, seen) : highRisk(advisory.severity)
    )
  }
  if (entries.some(([name, entry]) => highRisk(entry.severity) && !reachesAdvisory(name))) {
    throw new Error('High/critical finding has no reachable advisory')
  }
  return entries
}

function isCacheException(name, entry, advisory, context) {
  return (
    advisory.url === CACHE_ADVISORY &&
    advisory.severity === 'high' &&
    advisory.name === 'http-cache-semantics' &&
    name === 'http-cache-semantics' &&
    context.now.getTime() < CACHE_EXCEPTION_EXPIRES &&
    !context.production.vulnerabilities[name] &&
    Array.isArray(entry.nodes) &&
    entry.nodes.length > 0 &&
    entry.nodes.every(
      (node) =>
        node === 'node_modules/http-cache-semantics' &&
        context.lock?.packages?.[node]?.dev === true &&
        context.lock.packages[node].version === '4.2.0'
    )
  )
}

// SECURITY.md owns the approved exception, expiry and removal conditions.
export function auditFailures(full, production, lock, now = new Date()) {
  const prodEntries = vulnerabilities(production)
  const failures = prodEntries
    .filter(([, entry]) => highRisk(entry.severity))
    .map(([name]) => `production:${name}`)
  for (const [name, entry] of vulnerabilities(full)) {
    for (const advisory of entry.via) {
      if (typeof advisory === 'string') {
        continue
      }
      if (!highRisk(advisory.severity)) continue
      if (advisory.url === LEGACY_ESBUILD_ADVISORY) continue
      const allowedCacheAdvisory = isCacheException(name, entry, advisory, {
        production,
        lock,
        now
      })
      if (!allowedCacheAdvisory) failures.push(`${name}:${advisory.url}`)
    }
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [full, production, lock] = process.argv
      .slice(2)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    const failures = auditFailures(full, production, lock)
    if (failures.length) throw new Error(`Blocked advisories: ${failures.join(', ')}`)
    console.log('Audit policy passed; temporary dev-only exception expires 2026-10-31 UTC.')
  } catch (error) {
    console.error(`Audit policy failed: ${error.message}`)
    process.exitCode = 1
  }
}
