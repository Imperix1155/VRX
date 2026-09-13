import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExploreFilter,
  ExploreWorld,
  ExploreWorldReason,
  ExploreWorldSnapshot
} from '@shared/explore'
import { readExploreSnapshot, requestExploreImage } from '../queries/explore'

interface Selection {
  world: ExploreWorld
  opener: HTMLElement
  request: number
  reading: boolean
  dirty: boolean
  recoveredExpiredRef: boolean
  recovering: boolean
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

async function readChanges(
  selection: Selection,
  isCurrent: () => boolean,
  read: (selection: Selection, reason: ExploreWorldReason) => Promise<void>
): Promise<void> {
  if (!isCurrent() || selection.reading || selection.recovering || !selection.dirty) return
  selection.reading = true
  try {
    do {
      selection.dirty = false
      await read(selection, 'snapshot')
    } while (selection.dirty && isCurrent() && !selection.recovering)
  } finally {
    selection.reading = false
  }
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
    const next = {
      world,
      opener,
      request: 0,
      reading: false,
      dirty: false,
      recoveredExpiredRef: false,
      recovering: false
    }
    current.current = next
    setSelected(next)
    setSheet(null)
    setImage(undefined)
  }, [])

  const readImage = useCallback((selection: Selection) => {
    const ref = selection.world.worldRef
    void requestExploreImage(selection.world.platform, ref)
      .then((value) => {
        if (current.current === selection && selection.world.worldRef === ref) setImage(value)
      })
      .catch(() => undefined)
  }, [])

  const read = useCallback(
    async function readSelection(selection: Selection, reason: ExploreWorldReason): Promise<void> {
      if (current.current !== selection || !window.vrx?.getExploreWorld) return
      const request = ++selection.request
      let recovering = false
      try {
        const result = await window.vrx.getExploreWorld({
          platform: selection.world.platform,
          worldRef: selection.world.worldRef,
          reason
        })
        if (current.current !== selection || request !== selection.request) return
        if (result === null) {
          // Main may renew opaque references while the card is still rendered.
          // An explicit open gets one cache-only lookup for the same displayed
          // world, then reopens with the replacement reference. It never starts
          // discovery work or weakens the main-owned reference TTL.
          if (reason === 'open' && !selection.recoveredExpiredRef) {
            selection.recoveredExpiredRef = true
            selection.recovering = true
            recovering = true
            try {
              const snapshot = await readExploreSnapshot(selection.world.platform)
              if (current.current !== selection || request !== selection.request) return
              const renewed = snapshot.worlds.find(
                (world) =>
                  world.platform === selection.world.platform &&
                  world.worldId === selection.world.worldId &&
                  world.worldRef !== selection.world.worldRef
              )
              if (renewed !== undefined) {
                selection.world = renewed
                readImage(selection)
                const reopened = await window.vrx?.getExploreWorld?.({
                  platform: renewed.platform,
                  worldRef: renewed.worldRef,
                  reason: 'open'
                })
                if (current.current !== selection || request !== selection.request) return
                if (
                  reopened !== undefined &&
                  reopened !== null &&
                  reopened.platform === renewed.platform &&
                  reopened.world.worldId === renewed.worldId
                ) {
                  setSheet(reopened)
                } else close()
                return
              }
            } catch {
              // The old reference cannot be safely reopened without a current
              // cache answer. Close instead of retrying bridge work.
            }
          }
          if (current.current === selection && request === selection.request) close()
        } else if (
          result.platform === selection.world.platform &&
          result.world.worldId === selection.world.worldId
        ) {
          setSheet(result)
        }
      } catch {
        // Main normally supplies a closed error state. Preserve the last snapshot
        // if the bridge itself fails; there is no implicit retry.
      } finally {
        if (recovering) {
          selection.recovering = false
          await readChanges(selection, () => current.current === selection, readSelection)
        }
      }
    },
    [close, readImage]
  )

  useEffect(() => {
    const changed = window.vrx?.onExploreChanged?.(({ platform }) => {
      const selection = current.current
      if (selection === null || selection.world.platform !== platform) return
      selection.dirty = true
      void readChanges(selection, () => current.current === selection, read)
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
    readImage(selected)
  }, [read, readImage, selected])

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
