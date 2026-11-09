import { useEffect } from 'react'
import { parseReply, type Reply } from '../src/marker.ts'
import { markDecided } from './decided.ts'
import { ensureStyle } from './style.ts'

export const RULE_ID = 'approval-reply'

/** A user-text rule: a whole message in the reply format becomes one approval-reply node. */
export const replyRule = {
  id: RULE_ID,
  order: 5,
  match(text: string, from: number) {
    if (from !== 0) return undefined
    const reply = parseReply(text)
    return reply ? { id: RULE_ID, start: 0, end: text.length, data: reply } : undefined
  },
}

const LABEL = { approved: '✓ Approved', changed: '✓ Approved with changes', rejected: '✕ Rejected' }

/** The reply message drawn as one line instead of its JSON. */
export function ReplyNode(props: { data?: Reply; node?: { data?: Reply } }) {
  ensureStyle()
  const reply = props.data ?? props.node?.data
  useEffect(() => {
    if (reply) markDecided(reply)
  }, [reply])
  if (!reply) return null
  return (
    <span className="dsh-apr-reply" data-decision={reply.decision}>
      {LABEL[reply.decision]}
      {reply.comment ? ` · “${reply.comment}”` : ''}
      <span className="dsh-apr-reply-id"> · approval {reply.approval.slice(-6)}</span>
    </span>
  )
}
