import { describe, expect, it } from 'vitest'
import { createGroupResolver, type GroupMeta } from './GroupResolver'
import { fetchGroupMetadata } from './fetchGroupMetadata'

describe('fetchGroupMetadata', () => {
  it('returns an empty Map for empty input', async () => {
    const resolver = createGroupResolver({ fetcher: async () => ({ name: 'X', iconUrl: null }) })
    const result = await fetchGroupMetadata([], resolver)
    expect(result.size).toBe(0)
  })

  it('drops null, undefined, and empty-string entries', async () => {
    const calls: string[] = []
    const resolver = createGroupResolver({
      fetcher: async (groupId) => {
        calls.push(groupId)
        return { name: `Group ${groupId}`, iconUrl: null }
      }
    })
    const result = await fetchGroupMetadata([null, undefined, '', 'grp_a', null], resolver)
    expect(calls).toEqual(['grp_a'])
    expect(result.size).toBe(1)
  })

  it('deduplicates repeated groupIds within a batch', async () => {
    const calls: string[] = []
    const resolver = createGroupResolver({
      fetcher: async (groupId) => {
        calls.push(groupId)
        return { name: `Group ${groupId}`, iconUrl: null }
      }
    })
    const result = await fetchGroupMetadata(['grp_a', 'grp_a', 'grp_b'], resolver)
    expect(calls.sort()).toEqual(['grp_a', 'grp_b'])
    expect(result.size).toBe(2)
  })

  it('omits groups that resolve to null', async () => {
    const resolver = createGroupResolver({
      fetcher: async (groupId) =>
        groupId === 'grp_private' ? null : { name: groupId, iconUrl: null }
    })
    const result = await fetchGroupMetadata(['grp_a', 'grp_private', 'grp_b'], resolver)
    expect(result.has('grp_private')).toBe(false)
    expect(result.size).toBe(2)
  })

  it('streams each resolved group through onResolved without waiting for the batch', async () => {
    let releaseSlow!: (value: unknown) => void
    const slow = new Promise<unknown>((resolve) => {
      releaseSlow = resolve
    })
    const resolver = createGroupResolver({
      fetcher: async (groupId) =>
        groupId === 'grp_slow' ? slow : { name: 'Fast Group', iconUrl: null }
    })
    const resolved: Array<{ groupId: string; meta: GroupMeta }> = []
    let batchSettled = false

    const batch = fetchGroupMetadata(['grp_slow', 'grp_fast'], resolver, 2, (groupId, meta) =>
      resolved.push({ groupId, meta })
    ).then((result) => {
      batchSettled = true
      return result
    })
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(resolved).toEqual([
      {
        groupId: 'grp_fast',
        meta: { name: 'Fast Group', iconUrl: null }
      }
    ])
    expect(batchSettled).toBe(false)

    releaseSlow({ name: 'Slow Group', iconUrl: null })
    await expect(batch).resolves.toHaveProperty('size', 2)
    expect(resolved.map(({ groupId }) => groupId)).toEqual(['grp_fast', 'grp_slow'])
  })
})
