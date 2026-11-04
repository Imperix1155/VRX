/**
 * How long one person's answer serves the next reader: the same 30 s under
 * which a Refresh press treats a community answer as new.
 */
export const USER_READ_SHARE_MS = 30_000

/** People one session keeps a shared answer for. */
const MAX_SHARED_PEOPLE = 50

interface SharedRead {
  generation: number
  /** When the answer arrived; null while the read is still out. */
  at: number | null
  reply: Promise<unknown>
}

/**
 * One person's `GET /users/{id}` answer, shared by the reads that follow
 * opening their details: the full profile, the account-note check and, on
 * ChilloutVR, the block check. A reader joins a read that is still out or
 * takes an answer under USER_READ_SHARE_MS old, so those read the person once
 * instead of once each. Answers belong to one session generation, and a failed
 * read is never kept.
 */
export class UserReadShare {
  private readonly reads = new Map<string, SharedRead>()

  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** A running or recent answer for this person, otherwise a new read. */
  shared(generation: number, userId: string, load: () => Promise<unknown>): Promise<unknown> {
    const read = this.reads.get(userId)
    if (
      read?.generation === generation &&
      (read.at === null || this.clock() - read.at < USER_READ_SHARE_MS)
    ) {
      return read.reply
    }
    return this.fresh(generation, userId, load)
  }

  /** Always a new read (one that comes before a write); later readers may share it. */
  fresh(generation: number, userId: string, load: () => Promise<unknown>): Promise<unknown> {
    const read: SharedRead = { generation, at: null, reply: load() }
    this.reads.delete(userId)
    this.reads.set(userId, read)
    while (this.reads.size > MAX_SHARED_PEOPLE) this.reads.delete(this.reads.keys().next().value!)
    read.reply.then(
      () => {
        if (this.reads.get(userId) === read) read.at = this.clock()
      },
      () => {
        if (this.reads.get(userId) === read) this.reads.delete(userId)
      }
    )
    return read.reply
  }

  clear(): void {
    this.reads.clear()
  }
}
