import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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

// The only advisories the policy lets through. Each entry is one exact package
// and advisory, at high severity, in a development-only dependency that has no
// fixed release yet. SECURITY.md records the reason. `reviewBy` is the last day
// (UTC) the exception applies: after it the advisory blocks again until someone
// reviews the entry. A critical rating, another package, another advisory and
// a package that shows up in the production report are never let through.
export const auditExceptions = [
  {
    name: 'picomatch',
    url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    reviewBy: '2026-12-18'
  }
]

function excepted(name, advisory, inProduction, today) {
  return (
    advisory.severity === 'high' &&
    !inProduction.has(name) &&
    auditExceptions.some(
      (exception) =>
        exception.name === name && exception.url === advisory.url && today <= exception.reviewBy
    )
  )
}

// SECURITY.md also records the development-only HTTP cache patch; that patch
// is not an audit exception.
export function auditFailures(full, production, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const prodEntries = vulnerabilities(production)
  const inProduction = new Set(prodEntries.map(([name]) => name))
  const failures = prodEntries
    .filter(([, entry]) => highRisk(entry.severity))
    .map(([name]) => `production:${name}`)
  for (const [name, entry] of vulnerabilities(full)) {
    for (const advisory of entry.via) {
      if (typeof advisory === 'string') {
        continue
      }
      if (!highRisk(advisory.severity)) continue
      if (excepted(name, advisory, inProduction, today)) continue
      failures.push(`${name}:${advisory.url}`)
    }
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [full, production] = process.argv
      .slice(2, 4)
      .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    const failures = auditFailures(full, production)
    if (failures.length) throw new Error(`Blocked advisories: ${failures.join(', ')}`)
    console.log('Audit policy passed.')
  } catch (error) {
    console.error(`Audit policy failed: ${error.message}`)
    process.exitCode = 1
  }
}
