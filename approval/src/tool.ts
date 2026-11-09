import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ApprovalLog } from './log.ts'
import type { Reply } from './marker.ts'
import type { Waiters } from './waiters.ts'

export const TOOL = 'request_approval'

/** The model-facing instructions: when to ask, what to fill in, what each answer means. */
export const DESCRIPTION = `Ask the user to approve an action before you take it. The user sees a card in the chat with your request and can approve it, approve it with changes (editing target, subject or content), or reject it with a comment.

Use it before anything that leaves this system or is hard to undo: sending an email or message, posting or commenting, submitting a form with free text, paying or committing money, deleting data, changing an account, credentials or security settings. Reading, organizing and reversible local work need no approval.

Fill in the exact final version: \`content\` is what will be sent or done, word for word (the whole email body, the exact command or change); \`target\` is who or where (recipient, account, URL, path); \`subject\` when there is one. \`why\` says in one line what this is for; supporting facts go in \`details\`.

The result's status:
- approved: do it with exactly the returned target, subject and content.
- changed: the user edited the request; do it with exactly the returned (edited) fields and nothing else.
- rejected: do not do it; read the user's comment.
- pending: no decision within timeout_seconds. Do not do it yet. Continue with other work or end your turn; the decision arrives later as a user message starting "Approval <id>:" with the same fields as JSON, and you act on it then.

One request per action. If you change anything after approval, ask again.`

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    approval: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['approved', 'changed', 'rejected', 'pending'],
    },
    target: { type: 'string' },
    subject: { type: 'string' },
    content: { type: 'string' },
    comment: { type: 'string' },
  },
} as const

export interface ApprovalValue {
  approval: string
  status: 'approved' | 'changed' | 'rejected' | 'pending'
  target?: string
  subject?: string
  content?: string
  comment?: string
}

/** What the model reads back. */
export function renderValue(value: ApprovalValue, timeoutSeconds?: number): string {
  const fields = [
    value.target === undefined ? '' : `Target: ${value.target}`,
    value.subject === undefined ? '' : `Subject: ${value.subject}`,
    value.content === undefined ? '' : `Content:\n${value.content}`,
  ]
    .filter(Boolean)
    .join('\n')
  const comment = value.comment ? `\nUser's comment: ${value.comment}` : ''
  switch (value.status) {
    case 'approved':
      return `APPROVED (${value.approval}). Do it with exactly this:\n${fields}${comment}`
    case 'changed':
      return `APPROVED WITH CHANGES (${value.approval}). Do it with exactly this edited version, nothing else:\n${fields}${comment}`
    case 'rejected':
      return `REJECTED (${value.approval}). Do not do it.${comment}`
    case 'pending':
      return `PENDING (${value.approval}): no decision within ${timeoutSeconds ?? '?'} s. Do not do it yet. Continue with other work or end your turn; the decision will arrive as a user message starting "Approval ${value.approval}:".`
  }
}

export function resultOf(approval: string, reply: Reply, asked: Reply | undefined): ApprovalValue {
  const base = reply.decision === 'changed' ? reply : (asked ?? reply)
  return {
    approval,
    status: reply.decision,
    ...(base.target === undefined ? {} : { target: base.target }),
    ...(base.subject === undefined ? {} : { subject: base.subject }),
    ...(base.content === undefined ? {} : { content: base.content }),
    ...(reply.comment ? { comment: reply.comment } : {}),
  }
}

export function approvalTool(waiters: Waiters, log: ApprovalLog) {
  return defineTool({
    name: TOOL,
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'What will be done, briefly (e.g. "Send email", "Pay invoice").',
      },
      target: {
        type: 'string',
        description: 'Recipient, account, URL or path the action goes to.',
      },
      subject: { type: 'string', description: 'Subject or title, when the action has one.' },
      content: {
        type: 'string',
        required: true,
        description: 'The exact final content, word for word (full email body, exact command).',
      },
      why: { type: 'string', required: true, description: 'One line: what this is for.' },
      details: { type: 'string', description: 'Supporting facts the user may want to check.' },
      timeout_seconds: {
        type: 'number',
        description:
          'Optional: how long to wait for the decision before the tool returns "pending". Omit to wait until the user answers.',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (args, value) => [
        { type: 'text', text: renderValue(value as ApprovalValue, args.timeout_seconds) },
      ],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const approval = String(exec.callId)
      const asked: Reply = {
        approval,
        decision: 'approved',
        content: args.content,
        ...(args.target === undefined ? {} : { target: args.target }),
        ...(args.subject === undefined ? {} : { subject: args.subject }),
      }
      log.write({
        kind: 'request',
        approval,
        session: exec.agent ? String(exec.agent.id) : undefined,
        action: args.action,
        target: args.target,
        subject: args.subject,
        content: args.content,
        why: args.why,
        details: args.details,
      })
      const seconds = args.timeout_seconds
      const timeoutMs = seconds !== undefined && seconds > 0 ? seconds * 1000 : undefined
      const outcome = await waiters.wait(approval, timeoutMs, exec.signal)
      if (outcome === 'pending') {
        log.write({ kind: 'pending', approval, after_seconds: seconds })
        return { approval, status: 'pending' } satisfies ApprovalValue
      }
      return resultOf(approval, outcome, asked)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Approval: ${args.action}`,
      kind: 'other',
      rawInput: args,
    }),
  })
}
