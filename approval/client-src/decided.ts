import type { Reply } from '../src/marker.ts'

/**
 * Approvals the user has answered by message, as seen on this page: the reply's renderer records
 * them, and a card whose tool result still says "pending" reads them to stop offering its form.
 */
const decided = new Map<string, Reply>()
const listeners = new Set<() => void>()

export function markDecided(reply: Reply): void {
  if (decided.get(reply.approval)?.decision === reply.decision) return
  decided.set(reply.approval, reply)
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function decidedReply(approval: string): Reply | undefined {
  return decided.get(approval)
}
