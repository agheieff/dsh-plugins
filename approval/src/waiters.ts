import type { Reply } from './marker.ts'

export type Outcome = Reply | 'pending'

/** Tool calls waiting for the user's decision, by approval id (the tool call id). */
export class Waiters {
  private readonly waiting = new Map<string, (outcome: Outcome) => void>()

  /**
   * Resolves with the reply, or with `pending` once `timeoutMs` passes; rejects when `signal`
   * aborts (the turn was stopped). Without a timeout it waits for as long as it takes.
   */
  wait(id: string, timeoutMs: number | undefined, signal: AbortSignal): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      const finish = (outcome: Outcome): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.waiting.delete(id)
        resolve(outcome)
      }
      const onAbort = (): void => {
        clearTimeout(timer)
        this.waiting.delete(id)
        reject(signal.reason ?? new Error('The approval request was cancelled'))
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      if (timeoutMs !== undefined) timer = setTimeout(() => finish('pending'), timeoutMs)
      this.waiting.set(id, finish)
    })
  }

  /** Hands a reply to its waiting call. False when nothing waits for it. */
  deliver(reply: Reply): boolean {
    const finish = this.waiting.get(reply.approval)
    if (!finish) return false
    finish(reply)
    return true
  }
}
