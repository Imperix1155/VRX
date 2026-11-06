/**
 * Friend actions (owner, 2026-11-01): accept or decline a friend request in
 * the Inbox, or send one from a profile. Each call is one press; main decides
 * what goes out, spaces writes per platform, and never resends one on its own.
 * A failed bridge call reads as `unavailable` so the UI can say so.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { FriendActionResult, FriendRequestAnswer } from '@shared/friendActions'
import type { Platform } from '@shared/types'
import { inboxKey } from './inbox'

function failed(error: unknown): FriendActionResult {
  return {
    ok: false,
    reason:
      error instanceof Error && error.message === 'rate_limited' ? 'rate-limited' : 'unavailable'
  }
}

export async function answerFriendRequest(
  platform: Platform,
  id: string,
  answer: FriendRequestAnswer
): Promise<FriendActionResult> {
  try {
    if (typeof window.vrx?.answerFriendRequest !== 'function') return failed(null)
    return await window.vrx.answerFriendRequest({ platform, id, answer })
  } catch (error) {
    return failed(error)
  }
}

/**
 * `answerFriendRequest` that also re-reads the inbox once an answer went out,
 * so the row leaves even before main's `inbox-changed` push lands.
 */
export function useAnswerFriendRequest(): (
  platform: Platform,
  id: string,
  answer: FriendRequestAnswer
) => Promise<FriendActionResult> {
  const client = useQueryClient()
  return useCallback(
    async (platform: Platform, id: string, answer: FriendRequestAnswer) => {
      const result = await answerFriendRequest(platform, id, answer)
      if (result.ok) void client.invalidateQueries({ queryKey: inboxKey })
      return result
    },
    [client]
  )
}

export async function sendFriendRequest(
  platform: Platform,
  userId: string
): Promise<FriendActionResult> {
  try {
    if (typeof window.vrx?.sendFriendRequest !== 'function') return failed(null)
    return await window.vrx.sendFriendRequest({ platform, userId })
  } catch (error) {
    return failed(error)
  }
}
