import { describe, expect, it } from 'vitest'
import { auditFailures } from './audit-policy.mjs'

const url = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp'
const now = new Date('2026-10-03T23:40:17Z')
const report = (entries = {}) => {
  const vulnerabilities = Object.fromEntries(
    Object.entries(entries).map(([name, entry]) => [
      name,
      {
        via: [{ severity: entry.severity, url: `https://example.test/${name}` }],
        ...entry
      }
    ])
  )
  const counts = Object.fromEntries(
    ['info', 'low', 'moderate', 'high', 'critical'].map((severity) => [
      severity,
      Object.values(entries).filter((entry) => entry.severity === severity).length
    ])
  )
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { ...counts, total: Object.keys(entries).length } }
  }
}
const cache = () => ({
  severity: 'high',
  via: [{ name: 'http-cache-semantics', severity: 'high', url }],
  nodes: ['node_modules/http-cache-semantics']
})
const lock = () => ({
  packages: { 'node_modules/http-cache-semantics': { version: '4.2.0', dev: true } }
})
const full = () => report({ 'http-cache-semantics': cache() })
const evaluate = (all = full(), prod = report(), locked = lock(), time = now) =>
  auditFailures(all, prod, locked, time)

describe('dependency audit policy', () => {
  it('accepts the approved exact dev-only advisory before expiry, including cascade entries', () => {
    const all = full()
    all.vulnerabilities['cacheable-request'] = {
      severity: 'high',
      via: ['http-cache-semantics']
    }
    expect(evaluate(report(all.vulnerabilities))).toEqual([])
  })

  it.each(['high', 'critical'])(
    'blocks a different %s advisory alongside the exception',
    (severity) => {
      const all = full()
      all.vulnerabilities.other = {
        severity,
        via: [{ severity, url: 'https://example.test/other' }]
      }
      expect(evaluate(report(all.vulnerabilities))).toEqual(['other:https://example.test/other'])
    }
  )

  it('does not exempt a lookalike advisory URL', () => {
    const all = full()
    all.vulnerabilities['http-cache-semantics'].via[0].url += '/other'
    expect(evaluate(all)).toHaveLength(1)
  })

  it('does not exempt a critical escalation of the same advisory', () => {
    const all = full()
    all.vulnerabilities['http-cache-semantics'].via[0].severity = 'critical'
    all.vulnerabilities['http-cache-semantics'].severity = 'critical'
    expect(evaluate(report(all.vulnerabilities))).toHaveLength(1)
  })

  it.each([false, undefined])('requires explicit dev-only lockfile proof (%s)', (dev) => {
    const locked = lock()
    locked.packages['node_modules/http-cache-semantics'].dev = dev
    expect(evaluate(full(), report(), locked)).toHaveLength(1)
  })

  it('rejects missing lockfile data', () => {
    expect(evaluate(full(), report(), {})).toHaveLength(1)
  })

  it('rejects an unreviewed version', () => {
    const locked = lock()
    locked.packages['node_modules/http-cache-semantics'].version = '4.1.1'
    expect(evaluate(full(), report(), locked)).toHaveLength(1)
  })

  it('rejects a different installed path even if dev-only', () => {
    const all = full()
    all.vulnerabilities['http-cache-semantics'].nodes.push(
      'node_modules/other/node_modules/http-cache-semantics'
    )
    expect(evaluate(all)).toHaveLength(1)
  })

  it('still accepts the exception just before expiry', () => {
    expect(evaluate(full(), report(), lock(), new Date('2026-10-30T23:59:59Z'))).toEqual([])
  })

  it.each(['2026-10-31T00:00:00Z', '2026-11-01T00:00:00Z'])('expires at %s', (date) => {
    expect(evaluate(full(), report(), lock(), new Date(date))).toHaveLength(1)
  })

  it('does not block a fixed dependency tree after expiry', () => {
    expect(evaluate(report(), report(), {}, new Date('2026-11-01'))).toEqual([])
  })

  it.each(['high', 'critical'])('blocks production %s findings without exemptions', (severity) => {
    const prod = report({ 'http-cache-semantics': { ...cache(), severity } })
    expect(evaluate(full(), prod)).toContain('production:http-cache-semantics')
    expect(evaluate(full(), prod)).toContain(`http-cache-semantics:${url}`)
  })

  it('blocks a production-only finding even if full report omits it', () => {
    expect(evaluate(report(), report({ other: { severity: 'high' } }))).toEqual([
      'production:other'
    ])
  })

  it('retains the existing esbuild exception only outside production', () => {
    const esbuild = {
      severity: 'high',
      via: [{ severity: 'high', url: 'https://github.com/advisories/GHSA-g7r4-m6w7-qqqr' }]
    }
    expect(evaluate(report({ esbuild }))).toEqual([])
    expect(evaluate(report({ esbuild }), report({ esbuild }))).toEqual(['production:esbuild'])
  })

  it.each([{}, { error: { code: 'ENETWORK' } }, { ...report(), vulnerabilities: [] }])(
    'fails closed on invalid reports',
    (bad) => {
      expect(() => evaluate(bad)).toThrow()
      expect(() => evaluate(full(), bad)).toThrow()
    }
  )

  it('fails closed when a cascade target is absent', () => {
    expect(() => evaluate(report({ other: { via: ['missing'] } }))).toThrow()
  })
})

it('rejects incomplete high findings and cascade-only cycles', () => {
  expect(() => evaluate(report({ other: { severity: 'high', via: [] } }))).toThrow()
  expect(() =>
    evaluate(report({ a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a'] } }))
  ).toThrow()
})
it('rejects missing production severity and inconsistent metadata', () => {
  const badProduction = report({ other: { severity: 'critical' } })
  delete badProduction.vulnerabilities.other.severity
  expect(() => evaluate(full(), badProduction)).toThrow()
  const missingFinding = report()
  missingFinding.metadata.vulnerabilities.critical = 1
  missingFinding.metadata.vulnerabilities.total = 1
  expect(() => evaluate(missingFinding)).toThrow()
})
it('accepts real cascade cycles only when they reach the approved advisory', () => {
  const all = full()
  all.vulnerabilities.a = { severity: 'high', via: ['b'] }
  all.vulnerabilities.b = { severity: 'high', via: ['a', 'http-cache-semantics'] }
  expect(evaluate(report(all.vulnerabilities))).toEqual([])
})
