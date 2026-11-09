/**
 * `request_approval`: a model asks the user to approve, change or reject an action, through a card
 * in the chat. The rule to ask lives in the tool's instructions; nothing is blocked. The decision
 * comes back as a chat message (see marker.ts): while the tool still waits it becomes the tool's
 * result and is kept out of the conversation; after a timeout it reaches the model as a message.
 *
 * @module @agheieff/dsh-tool-approval
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { ApprovalLog } from './log.ts'
import { parseReply } from './marker.ts'
import { approvalTool } from './tool.ts'
import { Waiters } from './waiters.ts'

export const name = 'tool-request-approval'
export const inject = ['tools']

export interface Config {
  /** Command (argv) run with each request/decision record as JSON on stdin; empty runs nothing. */
  hook: string[]
  /** Where approvals.jsonl is kept. */
  dir?: string
}

export const Config: z<Config> = z.object({
  hook: z.array(z.string()).default([]),
  dir: z.string(),
})

function textOf(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

export function apply(ctx: Context, config: Config): void {
  const log = new ApprovalLog(
    config.dir ?? join(homedir(), '.dsh', 'approvals'),
    config.hook ?? [],
    (message) => ctx.logger.warn(message),
  )
  const waiters = new Waiters()
  /** Reply messages already given to their tool call: kept out of the next step. */
  const consumed = new Set<string>()
  ctx.tools.register(approvalTool(waiters, log))

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    const reply = parseReply(textOf(message))
    if (!reply) return
    const session = String(agent.id)
    if (log.isDecided(reply.approval)) {
      consumed.add(String(message.id))
      log.write({ kind: 'duplicate', approval: reply.approval, session, decision: reply.decision })
      return
    }
    const toTool = waiters.deliver(reply)
    if (toTool) consumed.add(String(message.id))
    log.write({ ...reply, kind: 'decision', session, via: toTool ? 'tool' : 'message' })
  })

  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const kept = decision.messages.filter((m) => !consumed.delete(String(m.id)))
    return kept.length === decision.messages.length ? decision : { ...decision, messages: kept }
  })
}
