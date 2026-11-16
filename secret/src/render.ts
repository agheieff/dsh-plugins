import type { Outcome } from './spec.ts'

/** What the model reads back; also the late chat message's body. */
export function renderOutcome(o: Outcome): string {
  const stored = (o.stored ?? [])
    .map((s) => `- ${s.where}: ${s.ok ? 'ok' : `FAILED (${s.error ?? 'unknown'})`}`)
    .join('\n')
  const comment = o.comment ? `\nUser's comment: ${o.comment}` : ''
  switch (o.status) {
    case 'saved':
    case 'partial':
      return `${o.status === 'saved' ? 'SAVED' : 'PARTLY SAVED'} (${o.request}): “${o.title}”, ${o.length} characters, ${o.fingerprint}. You do not get the value; read it from these places when needed, without printing it:\n${stored}${comment}`
    case 'declined':
      return `DECLINED (${o.request}): the user did not give “${o.title}”.${comment}`
    case 'pending':
      return `PENDING (${o.request}): no answer yet. Continue with other work or end your turn; the outcome will arrive as a user message starting "Secret ${o.request}:".`
  }
}

/** The chat message a late answer reaches the model as. */
export function lateMessage(o: Outcome): string {
  return `Secret ${o.request}: ${o.status}\n\n${renderOutcome(o)}`
}
