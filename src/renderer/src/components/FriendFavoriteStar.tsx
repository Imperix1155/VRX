import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Friend } from '@shared/types'
import {
  isFavoriteAccount,
  useFavoriteFriendKeys,
  useFavoriteFriends,
  useSetFavoriteFriends
} from '../queries/favorites'
import { FavoriteStarButton } from './FavoriteStar'

/**
 * The friend details star, beside the alerts bell (owner, 2026-11-01). A
 * linked person is one star across every account shown, so both platforms
 * move together. It reads starred while any shown account is, so unstarring
 * always clears every one of them. Kept only in VRX.
 */
export default function FriendFavoriteStar({
  accounts,
  name
}: {
  accounts: readonly Friend[]
  name: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const keys = useFavoriteFriendKeys()
  const vrchat = useFavoriteFriends('vrchat')
  const chilloutvr = useFavoriteFriends('chilloutvr')
  const setFavorite = useSetFavoriteFriends()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<{ owner: string; key: string } | null>(null)
  const owner = accounts.map((a) => `${a.platform}:${a.platformUserId}`).join('|')
  if (accounts.length === 0) return null
  const lists = { vrchat, chilloutvr }
  const on = isFavoriteAccount(keys, accounts)
  const writable = accounts.every((a) => lists[a.platform].writable)
  const shownFailure = failure?.owner === owner ? failure.key : null

  const toggle = async (): Promise<void> => {
    setFailure(null)
    setSaving(true)
    const reason = await setFavorite(accounts, !on)
    setSaving(false)
    if (reason !== null) {
      setFailure({
        owner,
        key: reason === 'full' ? 'favorites.friendsFull' : 'favorites.saveFailed'
      })
    }
  }

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      {shownFailure && (
        <p role="alert" className="max-w-[180px] text-right text-[11.5px] text-[var(--text-dim)]">
          {t(shownFailure)}
        </p>
      )}
      <FavoriteStarButton
        shape="round"
        on={on}
        disabled={!writable || saving}
        label={t('favorites.friendLabel', { name })}
        hint={t(on ? 'favorites.remove' : 'favorites.add')}
        onToggle={() => void toggle()}
      />
    </div>
  )
}
