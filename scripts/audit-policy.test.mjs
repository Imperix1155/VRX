import { describe, expect, it } from 'vitest'
import { auditFailures } from './audit-policy.mjs'

const url = 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp'
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
const full = () => report({ 'http-cache-semantics': cache() })
const evaluate = (all = full(), prod = report()) => auditFailures(all, prod)

describe('dependency audit policy', () => {
  it('does not exempt GHSA-ch52-4w7c-c8xp, including a cascade parent', () => {
    const all = full()
    all.vulnerabilities['cacheable-request'] = {
      severity: 'high',
      via: ['http-cache-semantics']
    }
    expect(evaluate(report(all.vulnerabilities))).toEqual([`http-cache-semantics:${url}`])
  })

  it.each(['high', 'critical'])(
    'blocks a different %s advisory together with the former cache advisory',
    (severity) => {
      const all = full()
      all.vulnerabilities.other = {
        severity,
        via: [{ severity, url: 'https://example.test/other' }]
      }
      expect(evaluate(report(all.vulnerabilities))).toEqual([
        `http-cache-semantics:${url}`,
        'other:https://example.test/other'
      ])
    }
  )

  it('does not exempt a lookalike advisory URL', () => {
    const all = full()
    all.vulnerabilities['http-cache-semantics'].via[0].url += '/other'
    expect(evaluate(all)).toEqual([`http-cache-semantics:${url}/other`])
  })

  it('does not exempt a critical escalation of the same advisory', () => {
    const all = full()
    all.vulnerabilities['http-cache-semantics'].via[0].severity = 'critical'
    all.vulnerabilities['http-cache-semantics'].severity = 'critical'
    expect(evaluate(report(all.vulnerabilities))).toEqual([`http-cache-semantics:${url}`])
  })

  it('does not block a report with no high or critical advisory', () => {
    expect(evaluate(report(), report())).toEqual([])
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

  it('no longer exempts the esbuild advisory now that the tree is fixed', () => {
    const esbuildUrl = 'https://github.com/advisories/GHSA-g7r4-m6w7-qqqr'
    const esbuild = { severity: 'high', via: [{ severity: 'high', url: esbuildUrl }] }
    expect(evaluate(report({ esbuild }))).toEqual([`esbuild:${esbuildUrl}`])
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
it('blocks a high advisory reached through a cascade cycle', () => {
  const all = full()
  all.vulnerabilities.a = { severity: 'high', via: ['b'] }
  all.vulnerabilities.b = { severity: 'high', via: ['a', 'http-cache-semantics'] }
  expect(evaluate(report(all.vulnerabilities))).toEqual([`http-cache-semantics:${url}`])
})
