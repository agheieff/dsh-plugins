import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Outcome, Spec } from './spec.ts'

type Kind = 'request' | 'pending' | 'cancelled' | 'saved' | 'partial' | 'declined'

/** One line of `requests.jsonl`. Holds the spec and outcomes, never a secret value. */
interface Record {
  kind: Kind
  request: string
  at: string
  session?: string
  spec?: Spec
  outcome?: Outcome
}

/**
 * Every secret request and its outcome, in `<dir>/requests.jsonl`, plus the tool calls still
 * waiting. The log lets a late answer (after a timeout or a restart) still be stored.
 */
export class Requests {
  private readonly path: string
  private readonly specs = new Map<string, Spec>()
  private readonly closed = new Map<string, Kind>()
  private readonly outcomes = new Map<string, Outcome>()
  private readonly waiting = new Map<string, (outcome: Outcome) => void>()
  /** Requests being stored right now: one submission at a time. */
  readonly busy = new Set<string>()

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.path = join(dir, 'requests.jsonl')
    let text = ''
    try {
      text = readFileSync(this.path, 'utf8')
    } catch {}
    for (const line of text.split('\n')) {
      if (line) this.apply(JSON.parse(line) as Record)
    }
  }

  private apply(record: Record): void {
    if (record.kind === 'request' && record.spec) this.specs.set(record.request, record.spec)
    if (record.kind === 'pending') return
    if (record.kind !== 'request') this.closed.set(record.request, record.kind)
    if (record.outcome) this.outcomes.set(record.request, record.outcome)
  }

  private write(record: Omit<Record, 'at'>): void {
    const full = { ...record, at: new Date().toISOString() }
    this.apply(full)
    appendFileSync(this.path, `${JSON.stringify(full)}\n`, { mode: 0o600 })
  }

  open(request: string, spec: Spec, session?: string): void {
    this.write({ kind: 'request', request, spec, ...(session ? { session } : {}) })
  }

  /** Waits for the answer; `pending` after `timeoutMs`; rejects when the turn stops. */
  wait(request: string, timeoutMs: number | undefined, signal: AbortSignal): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      const done = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.waiting.delete(request)
      }
      const onAbort = (): void => {
        done()
        if (!this.closed.has(request)) this.write({ kind: 'cancelled', request })
        reject(signal.reason ?? new Error('The secret request was cancelled'))
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          done()
          this.write({ kind: 'pending', request })
          resolve({ request, status: 'pending', title: this.specs.get(request)?.title ?? '' })
        }, timeoutMs)
      }
      this.waiting.set(request, (outcome) => {
        done()
        resolve(outcome)
      })
    })
  }

  spec(request: string): Spec | undefined {
    return this.specs.get(request)
  }

  /** Why an answer for this request cannot be taken, if it cannot. */
  refusal(request: string): string | undefined {
    if (!this.specs.has(request)) return 'unknown request'
    const closed = this.closed.get(request)
    if (closed === 'cancelled') return 'this request was cancelled'
    if (closed) return 'this request is already answered'
    if (this.busy.has(request)) return 'already being stored'
    return undefined
  }

  outcome(request: string): Outcome | undefined {
    return this.outcomes.get(request)
  }

  /** Records the answer and hands it to the waiting call; false when nothing waits. */
  finish(outcome: Outcome): boolean {
    this.write({ kind: outcome.status as Kind, request: outcome.request, outcome })
    const deliver = this.waiting.get(outcome.request)
    deliver?.(outcome)
    return deliver !== undefined
  }
}
