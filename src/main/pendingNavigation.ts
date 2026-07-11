/** One-slot main-process intent queue for renderer navigation requests. */
export class PendingNavigation<T> {
  private pending = false

  constructor(private readonly send: (target: T) => void) {}

  request(target: T, ready: boolean): void {
    if (ready) {
      this.pending = false
      this.send(target)
      return
    }
    this.pending = true
  }

  rendererReady(target: T): void {
    if (!this.pending) return
    this.pending = false
    this.send(target)
  }
}
