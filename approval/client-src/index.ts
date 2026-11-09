/** Browser half: the `request_approval` card, registered in dsh's per-tool card slot. */
import { ApprovalCard } from './ApprovalCard.tsx'
import { ReplyNode, RULE_ID, replyRule } from './ReplyNode.tsx'

interface Slots {
  inject(name: string, register: () => unknown): void
  register(entry: { name: string; key: string; priority?: number }, component: unknown): unknown
}

interface Ctx {
  slots: Slots
  uiConversation: { userText: { register(rule: unknown): unknown } }
}

export const inject = ['slots', 'uiConversation']

export function apply(ctx: Ctx): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'request_approval' }, ApprovalCard),
  )
  ctx.uiConversation.userText.register(replyRule)
  ctx.slots.inject('conversation.user.text.node', () =>
    ctx.slots.register(
      { name: 'conversation.user.text.node', key: RULE_ID, priority: 100 },
      ReplyNode,
    ),
  )
}
