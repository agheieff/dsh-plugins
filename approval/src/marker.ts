/**
 * The user's decision travels back as one ordinary chat message in this format, so it needs no
 * private channel: the card sends it, the host reads it, and a model that receives it late (after
 * the tool stopped waiting) can read it too.
 */

export type Decision = 'approved' | 'changed' | 'rejected'

/** What the user approves: the target, an optional subject and the exact content. */
export interface Fields {
  target?: string
  subject?: string
  content: string
}

export interface Reply extends Partial<Fields> {
  /** The tool call id of the request. */
  approval: string
  decision: Decision
  comment?: string
}

const HEAD = 'Approval '
const LABEL: Record<Decision, string> = {
  approved: 'approved',
  changed: 'approved with changes',
  rejected: 'rejected',
}

export function formatReply(reply: Reply): string {
  const body = JSON.stringify(reply, null, 1)
  return `${HEAD}${reply.approval}: ${LABEL[reply.decision]}\n\n\`\`\`json\n${body}\n\`\`\``
}

export function parseReply(text: string): Reply | undefined {
  if (!text.trimStart().startsWith(HEAD)) return undefined
  const fenced = /```json\s*\n([\s\S]*?)\n\s*```/.exec(text)
  if (!fenced?.[1]) return undefined
  try {
    const value = JSON.parse(fenced[1]) as Partial<Reply>
    if (typeof value.approval !== 'string' || !value.approval) return undefined
    if (
      value.decision !== 'approved' &&
      value.decision !== 'changed' &&
      value.decision !== 'rejected'
    ) {
      return undefined
    }
    return value as Reply
  } catch {
    return undefined
  }
}
