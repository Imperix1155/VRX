import { describe, expect, it, vi } from 'vitest'
import { PendingNavigation } from './pendingNavigation'

describe('PendingNavigation', () => {
  it('replays once when a just-recreated renderer becomes ready', () => {
    const send = vi.fn()
    const navigation = new PendingNavigation<string>(send)

    navigation.request('recreated-window', false)
    expect(send).not.toHaveBeenCalled()

    navigation.rendererReady('recreated-window')
    navigation.rendererReady('recreated-window')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('recreated-window')
  })

  it('sends immediately to a ready renderer without leaving a replay behind', () => {
    const send = vi.fn()
    const navigation = new PendingNavigation<string>(send)

    navigation.request('loaded-window', true)
    navigation.rendererReady('loaded-window')

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('loaded-window')
  })
})
