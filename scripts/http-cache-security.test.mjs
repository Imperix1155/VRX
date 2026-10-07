import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { patchedSource, patchHttpCache } from './patch-http-cache.mjs'

const require = createRequire(import.meta.url)
const CachePolicy = require('http-cache-semantics')
const CacheableRequest = require('cacheable-request')
const request = { url: 'https://fixture.invalid/artifact', method: 'GET', headers: {} }
const staleRequest = (value = 'max-stale=99999') => ({
  ...request,
  headers: { 'cache-control': value }
})
const policy = (headers, options) =>
  new CachePolicy(request, { status: 200, headers: { age: '10', ...headers } }, options)

describe('HTTP cache security reuse boundary', () => {
  it('requires the exact patched install and rejects unexpected source', () => {
    expect(() => patchHttpCache(true)).not.toThrow()
    const installed = readFileSync(require.resolve('http-cache-semantics'), 'utf8')
    expect(patchedSource(installed)).toBe(installed)
    expect(() => patchedSource(`${installed}\n`)).toThrow('Unexpected')
  })

  it.each(['max-stale=99999', 'max-stale', 'no-cache'])(
    'cacheable-request does not disclose the previous response for %s',
    async (directive) => {
      let requests = 0
      let stored
      const written = new Promise((resolve) => {
        stored = resolve
      })
      class Store extends Map {
        set(key, value) {
          super.set(key, value)
          stored()
          return this
        }
      }
      const cachedRequest = new CacheableRequest((options, callback) => {
        const req = new EventEmitter()
        req.end = () => {
          requests++
          const response = new PassThrough()
          response.statusCode = 200
          response.headers =
            requests === 1
              ? {
                  'cache-control': 'max-age=3600, stale-if-error=600',
                  'set-cookie': ['fixture=synthetic']
                }
              : { 'cache-control': 'no-store' }
          response.url = request.url
          callback(response)
          response.end(requests === 1 ? 'synthetic private response' : 'anonymous response')
        }
        return req
      }, new Store())
      const fetch = (headers) =>
        new Promise((resolve, reject) => {
          const event = cachedRequest(
            { protocol: 'https:', hostname: 'fixture.invalid', path: '/artifact', headers },
            async (response) => {
              const chunks = []
              for await (const chunk of response) chunks.push(chunk)
              resolve({ body: Buffer.concat(chunks).toString(), headers: response.headers })
            }
          )
          event.on('error', reject)
          event.on('request', (req) => req.end())
        })
      await fetch({})
      await written
      const second = await fetch({ 'cache-control': directive })
      expect(requests).toBe(2)
      expect(second.body).toBe('anonymous response')
      expect(second.headers['set-cookie']).toBeUndefined()
    }
  )
  for (const [name, headers] of Object.entries({
    cookie: { 'set-cookie': ['fixture=synthetic'], 'cache-control': 'max-age=3600' },
    revalidate: { 'cache-control': 'proxy-revalidate, max-age=3600' },
    noCache: { 'cache-control': 'no-cache, max-age=3600' },
    noStore: { 'cache-control': 'no-store, max-age=3600' },
    private: { 'cache-control': 'private, max-age=3600' },
    mustRevalidate: { 'cache-control': 'must-revalidate, max-age=0' }
  })) {
    for (const serialized of [false, true]) {
      it(`${name}: rejects max-stale, SWR and error reuse (serialized=${serialized})`, () => {
        let p = policy({
          ...headers,
          'cache-control': `${headers['cache-control']}, stale-while-revalidate=600, stale-if-error=600`
        })
        if (serialized) p = CachePolicy.fromObject(JSON.parse(JSON.stringify(p.toObject())))
        for (const directive of ['max-stale=99999', 'max-stale', 'max-stale="99999"']) {
          expect(p.satisfiesWithoutRevalidation(staleRequest(directive))).toBe(false)
          expect(p.evaluateRequest(staleRequest(directive)).response).toBeUndefined()
        }
        expect(p.evaluateRequest(request).response).toBeUndefined()
        expect(p.useStaleWhileRevalidate()).toBe(false)
        for (const status of [500, 502, 503, 504]) {
          expect(p.revalidatedPolicy(request, { status, headers: {} }).modified).toBe(true)
        }
      })
    }
  }

  it('retains ordinary zero-age max-stale and eligible stale extensions', () => {
    const p = policy({
      'cache-control': 'public, max-age=0, stale-while-revalidate=600, stale-if-error=600'
    })
    expect(p.satisfiesWithoutRevalidation(staleRequest())).toBe(true)
    expect(p.satisfiesWithoutRevalidation(staleRequest('max-stale'))).toBe(true)
    expect(p.evaluateRequest(request).revalidation.synchronous).toBe(false)
    expect(p.revalidatedPolicy(request, { status: 503, headers: {} }).modified).toBe(false)
  })

  it('retains fresh/public cookie and private-cache behavior', () => {
    for (const [headers, options] of [
      [{ 'cache-control': 'max-age=3600' }],
      [{ 'cache-control': 'public, max-age=3600', 'set-cookie': 'fixture=synthetic' }],
      [
        { 'cache-control': 'private, max-age=3600', 'set-cookie': 'fixture=synthetic' },
        { shared: false }
      ]
    ])
      expect(policy(headers, options).satisfiesWithoutRevalidation(request)).toBe(true)
  })

  it('retains request and variant matching restrictions', () => {
    const p = policy({ 'cache-control': 'public, max-age=3600', vary: 'accept-language' })
    for (const req of [
      staleRequest('no-cache'),
      { ...request, url: 'https://fixture.invalid/other' },
      { ...request, method: 'POST' },
      { ...request, headers: { 'accept-language': 'fr' } }
    ])
      expect(p.satisfiesWithoutRevalidation(req)).toBe(false)
  })
})
