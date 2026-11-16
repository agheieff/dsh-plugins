import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Requests } from './requests.ts'
import type { Outcome } from './spec.ts'
import { fingerprint, type Store } from './store.ts'

export const SUBMIT_PATH = '/secret-request/submit'
export const STATE_PATH = '/secret-request/state'

const MAX_BODY = 64 * 1024

export interface Body {
  request: string
  /** The secret; absent when the user declines. */
  secret?: string
  decline?: boolean
  comment?: string
}

/** The answer to the card: the outcome, and whether a waiting tool call received it. */
export interface Answer {
  outcome?: Outcome
  delivered?: boolean
  error?: string
}

function send(res: ServerResponse, status: number, answer: Answer): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(answer))
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Stores one answer; the secret stays in this function and the store, never in a log. */
export async function answer(requests: Requests, store: Store, body: Body): Promise<Answer> {
  const refusal = requests.refusal(body.request)
  if (refusal) return { error: refusal }
  const spec = requests.spec(body.request)
  if (!spec) return { error: 'unknown request' }
  const comment = body.comment?.trim() ? { comment: body.comment.trim() } : {}
  if (body.decline) {
    const outcome: Outcome = {
      request: body.request,
      status: 'declined',
      title: spec.title,
      ...comment,
    }
    return { outcome, delivered: requests.finish(outcome) }
  }
  const secret = body.secret?.trim() ?? ''
  if (!secret) return { error: 'empty secret' }
  requests.busy.add(body.request)
  try {
    const stored = await store.save(spec, secret)
    if (!stored.some((s) => s.ok)) {
      return { error: stored.map((s) => `${s.where}: ${s.error}`).join('; ') }
    }
    const outcome: Outcome = {
      request: body.request,
      status: stored.every((s) => s.ok) ? 'saved' : 'partial',
      title: spec.title,
      stored,
      fingerprint: fingerprint(secret),
      length: secret.length,
      ...comment,
    }
    return { outcome, delivered: requests.finish(outcome) }
  } finally {
    requests.busy.delete(body.request)
  }
}

/** Route handlers; `rejected` applies dsh's Host/Origin fence and browser sign-in. */
export function handlers(
  requests: Requests,
  store: Store,
  rejected: (req: IncomingMessage) => number | undefined,
) {
  const fence = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    const status = rejected(req)
    if (status !== undefined) {
      res.statusCode = status
      res.end()
      return false
    }
    if (req.method !== method) {
      res.setHeader('allow', method)
      send(res, 405, { error: `use ${method}` })
      return false
    }
    return true
  }
  return {
    async submit(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!fence(req, res, 'POST')) return
      let body: Body
      try {
        body = JSON.parse(await readBody(req)) as Body
        if (typeof body.request !== 'string') throw new Error('no request')
      } catch {
        return send(res, 400, { error: 'bad request body' })
      }
      const result = await answer(requests, store, body)
      send(res, result.error ? 409 : 200, result)
    },
    state(req: IncomingMessage, res: ServerResponse): void {
      if (!fence(req, res, 'GET')) return
      const id = new URL(String(req.url), 'http://localhost').searchParams.get('request') ?? ''
      const outcome = requests.outcome(id)
      const refusal = requests.refusal(id)
      send(res, 200, outcome ? { outcome } : refusal ? { error: refusal } : {})
    },
  }
}
