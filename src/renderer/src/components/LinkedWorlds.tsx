import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isHotInstanceMember } from '@shared/hotInstanceKey'
import type { Friend } from '@shared/types'
import { useAvatar } from '../hooks/useAvatar'
import { useSettingsStore } from '../stores/settings'
import { instancePillFor } from '../utils/instancePill'
import { inPlatformOrder } from '../utils/platformOrder'
import InstancePill from './InstancePill'

function RowWorld({
  friend,
  showAccess
}: {
  friend: Friend
  showAccess: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { labelScheme } = useSettingsStore((state) => state.settings)
  // Two joinable locations share one split pill whose halves carry each
  // access tier by color, so each location's access word sits here too.
  const pill =
    showAccess && isHotInstanceMember(friend) && friend.instance
      ? instancePillFor(friend.instance, labelScheme)
      : null
  return (
    <span data-linked-world-group="" className="linked-world-group">
      <span className={`linked-world-platform linked-platform-${friend.platform}`}>
        {t(
          friend.platform === 'vrchat'
            ? 'friends.platform.vrchatShort'
            : 'friends.platform.chilloutvrShort'
        )}
      </span>
      {pill && (
        <span
          data-linked-world-access=""
          className="shrink-0 text-[11px] font-semibold leading-[16px]"
          style={{ color: pill.tier ? `var(--op-${pill.tier}-text)` : 'var(--text-dim)' }}
        >
          {t(pill.labelKey)}
        </span>
      )}
      <span className="linked-world-name">
        {isHotInstanceMember(friend)
          ? (friend.instance?.worldName ?? t('friends.instance.unknownWorld'))
          : t('drawer.hidden')}
      </span>
    </span>
  )
}

function WorldLayer({ friend, split }: { friend: Friend; split: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { labelScheme } = useSettingsStore((state) => state.settings)
  const ref = useRef<HTMLDivElement>(null)
  const visible = isHotInstanceMember(friend)
  const source = visible ? (friend.instance?.thumbnailUrl ?? null) : null
  const image = useAvatar(source, ref)
  const imageKey = JSON.stringify([friend.platform, friend.platformUserId, source, image])
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const lower = split && friend.platform === 'chilloutvr'
  const clip = split
    ? friend.platform === 'vrchat'
      ? 'polygon(0 0, 100% 0, 100% 100%)'
      : 'polygon(0 0, 100% 100%, 0 100%)'
    : undefined
  const pill = visible && friend.instance ? instancePillFor(friend.instance, labelScheme) : null
  return (
    <>
      <div
        ref={ref}
        data-linked-world-layer={friend.platform}
        className="linked-world-image"
        style={{ clipPath: clip }}
      >
        {visible && image && failedKey !== imageKey && (
          <img src={image} alt="" onError={() => setFailedKey(imageKey)} />
        )}
      </div>
      <div
        data-linked-world-position={lower ? 'cvr-lower-left' : split ? 'vrc-upper-right' : 'single'}
        className={`linked-world-overlay ${lower ? 'linked-world-lower' : 'linked-world-upper'}`}
      >
        {pill && (
          <span className="linked-world-pill">
            <InstancePill label={t(pill.labelKey)} tier={pill.tier} />
          </span>
        )}
        <span className="linked-world-caption">
          {visible
            ? (friend.instance?.worldName ?? t('friends.instance.unknownWorld'))
            : t('drawer.hidden')}
        </span>
      </div>
      <span
        aria-hidden="true"
        className={`linked-world-outline linked-platform-${friend.platform}`}
        style={{ clipPath: clip }}
      />
    </>
  )
}

export default function LinkedWorlds({
  accounts,
  variant,
  showAccess = false
}: {
  accounts: Friend[]
  variant: 'row' | 'drawer'
  /** Row only: name each location's access (the row's split "2 locations" pill). */
  showAccess?: boolean
}): React.JSX.Element | null {
  const worlds = inPlatformOrder(
    accounts.filter((friend) => friend.presence.state === 'in-game')
  ).slice(0, 2)
  if (worlds.length === 0) return null
  if (variant === 'row')
    return (
      <span data-linked-worlds="" className="linked-world-pair">
        {worlds.map((friend) => (
          <RowWorld
            key={`${friend.platform}:${friend.platformUserId}`}
            friend={friend}
            showAccess={showAccess}
          />
        ))}
      </span>
    )
  return (
    <div
      data-linked-worlds=""
      className={`linked-world-composite ${worlds.length === 2 ? 'linked-world-split' : ''}`}
    >
      {worlds.map((friend) => (
        <WorldLayer
          key={`${friend.platform}:${friend.platformUserId}`}
          friend={friend}
          split={worlds.length === 2}
        />
      ))}
    </div>
  )
}
