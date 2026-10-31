/**
 * World cards that open the shared Explore world sheet, with its rooms and
 * Join. Used by Explore's lists and by Search. Every world here carries a
 * main-issued `worldRef`, so pictures, the sheet and Join take the exact same
 * path as Popular now.
 */
import { useState } from 'react'
import type { ExploreWorld } from '@shared/explore'
import { useExploreImage } from '../hooks/useExploreImage'
import { useExploreWorldSelection, type RecoverWorlds } from '../hooks/useExploreWorldSelection'
import { useJoinInstance } from '../hooks/useJoinInstance'
import { useFriendsStore } from '../stores/friends'
import ExploreWorldCard from './ExploreWorldCard'
import ExploreWorldSheet from './ExploreWorldSheet'

/** A world card that resolves its picture once it nears the viewport. */
export function ResolvedCard({
  world,
  onOpen,
  layout = 'card'
}: {
  world: ExploreWorld
  onOpen: (world: ExploreWorld, opener: HTMLElement) => void
  layout?: 'card' | 'bar'
}): React.JSX.Element {
  const { ref, image } = useExploreImage(world.platform, world.worldRef)
  return (
    <div ref={ref} className="h-full w-full">
      <ExploreWorldCard world={world} image={image} onOpen={onOpen} layout={layout} />
    </div>
  )
}

/**
 * `recover` re-reads the results these worlds came from. Main renews a world's
 * reference only when it hands that world out again, so an expired card is
 * recovered from its own search or list, never from Popular now.
 */
export default function WorldResults({
  worlds,
  recover
}: {
  worlds: readonly ExploreWorld[]
  recover: RecoverWorlds
}): React.JSX.Element {
  const platformFilter = useFriendsStore((state) => state.platformFilter)
  const { selected, sheet, image, open, close, refresh } = useExploreWorldSelection(
    platformFilter,
    recover
  )
  const { isJoining, joinExplore, joinExploreFailureFor, pendingConfirm } = useJoinInstance()
  const [focusFallback, setFocusFallback] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setFocusFallback} tabIndex={-1} className="focus:outline-none">
      <div className="grid grid-cols-1 gap-[var(--space-4)] md:grid-cols-2">
        {worlds.map((world) => (
          <ResolvedCard key={`${world.platform}:${world.worldId}`} world={world} onOpen={open} />
        ))}
      </div>
      <ExploreWorldSheet
        snapshot={sheet}
        image={image}
        opener={selected?.opener ?? null}
        focusFallback={focusFallback}
        onClose={close}
        onRefresh={refresh}
        onJoin={(room) => {
          if (sheet !== null) void joinExplore(sheet.world, room)
        }}
        dismissable={pendingConfirm === null}
        joining={isJoining}
        joinFailureFor={(room) =>
          sheet !== null ? joinExploreFailureFor(sheet.world, room) : null
        }
      />
    </div>
  )
}
