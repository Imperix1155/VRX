import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExploreFilter,
  ExploreWorld,
  ExploreWorldReason,
  ExploreWorldSnapshot
} from '@shared/explore'
import { requestExploreImage } from '../queries/explore'

interface Selection {
  world: ExploreWorld
  opener: HTMLElement
  request: number
  reading: boolean
  dirty: boolean
}

function cancel(selection: Selection | null): void {
  if (selection === null) return
  void window.vrx
    ?.cancelExploreWorld?.({
      platform: selection.world.platform,
      worldRef: selection.world.worldRef
    })
    .catch(() => undefined)
}

/** Dashboard and Explore share one selected-world lifetime. Every reply belongs
 * to that selection and a request order; an older loading read cannot replace
 * a newer completed snapshot. No timer starts bridge work here. */
export function useExploreWorldSelection(filter: ExploreFilter): {
  selected: Selection | null
  sheet: ExploreWorldSnapshot | null
  image: string | undefined
  open: (world: ExploreWorld, opener: HTMLElement) => void
  close: () => void
  refresh: () => void
} {
  const current = useRef<Selection | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [sheet, setSheet] = useState<ExploreWorldSnapshot | null>(null)
  const [image, setImage] = useState<string | undefined>()
  const close = useCallback(() => {
    const previous = current.current
    current.current = null
    cancel(previous)
    setSelected(null)
    setSheet(null)
    setImage(undefined)
  }, [])
  const open = useCallback((world: ExploreWorld, opener: HTMLElement) => {
    cancel(current.current)
    const next = { world, opener, request: 0, reading: false, dirty: false }
    current.current = next
    setSelected(next)
    setSheet(null)
    setImage(undefined)
  }, [])

  const read = useCallback(
    async (selection: Selection, reason: ExploreWorldReason) => {
      if (current.current !== selection || !window.vrx?.getExploreWorld) return
      const request = ++selection.request
      try {
        const result = await window.vrx.getExploreWorld({
          platform: selection.world.platform,
          worldRef: selection.world.worldRef,
          reason
        })
        if (current.current !== selection || request !== selection.request) return
        if (result === null) {
          close()
        } else if (
          result.platform === selection.world.platform &&
          result.world.worldId === selection.world.worldId
        ) {
          setSheet(result)
        }
      } catch {
        // Main normally supplies a closed error state. Preserve the last snapshot
        // if the bridge itself fails; there is no implicit retry.
      }
    },
    [close]
  )

  useEffect(() => {
    const changed = window.vrx?.onExploreChanged?.(({ platform }) => {
      const selection = current.current
      if (selection === null || selection.world.platform !== platform) return
      if (selection.reading) {
        selection.dirty = true
        return
      }
      selection.reading = true
      void (async () => {
        do {
          selection.dirty = false
          await read(selection, 'snapshot')
        } while (selection.dirty && current.current === selection)
      })().finally(() => {
        selection.reading = false
      })
    })
    const boundary = window.vrx?.onIdentityBoundary?.(({ platform }) => {
      if (current.current?.world.platform === platform) close()
    })
    const friend = window.vrx?.onFriendEvent?.((event) => {
      if (event.type === 'auth-invalidated' && current.current?.world.platform === event.platform)
        close()
    })
    return () => {
      changed?.()
      boundary?.()
      friend?.()
      const previous = current.current
      current.current = null
      cancel(previous)
    }
  }, [close, read])

  useEffect(() => {
    if (selected === null || current.current !== selected) return
    void read(selected, 'open')
    void requestExploreImage(selected.world.platform, selected.world.worldRef)
      .then((value) => {
        if (current.current === selected) setImage(value)
      })
      .catch(() => undefined)
  }, [read, selected])

  useEffect(() => {
    const selection = current.current
    if (selection === null || filter === 'all' || selection.world.platform === filter) return
    // Fence synchronously; defer the state update to respect the render/effect boundary.
    current.current = null
    cancel(selection)
    queueMicrotask(() => {
      if (current.current === null) close()
    })
  }, [close, filter])

  const refresh = useCallback(() => {
    if (current.current !== null) void read(current.current, 'manual')
  }, [read])
  return { selected, sheet, image, open, close, refresh }
}
