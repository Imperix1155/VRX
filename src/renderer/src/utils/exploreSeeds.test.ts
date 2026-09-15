import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

it.each([
  [0.25, 'vrchat'],
  [0.75, 'chilloutvr']
] as const)('assigns either platform the lower tie seed for draw %s', async (draw, leader) => {
  vi.resetModules()
  vi.spyOn(Math, 'random').mockReturnValue(draw)
  const { EXPLORE_SESSION_SEEDS: seeds } = await import('./exploreSeeds')
  expect(seeds.vrchat).not.toBe(seeds.chilloutvr)
  const other = leader === 'vrchat' ? 'chilloutvr' : 'vrchat'
  expect(seeds[leader]).toBeLessThan(seeds[other])
})
