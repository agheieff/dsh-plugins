import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { type Decision, formatReply, type Reply } from '../src/marker.ts'
import { decidedReply, subscribe } from './decided.ts'
import { ensureStyle } from './style.ts'

interface Args {
  action?: string
  target?: string
  subject?: string
  content?: string
  why?: string
  details?: string
  timeout_seconds?: number
}

interface Result {
  approval: string
  status: Decision | 'pending'
  target?: string
  subject?: string
  content?: string
  comment?: string
}

interface InputActions {
  setDraft(text: string): void
  submit(): void
}

/** The owner props this card reads (dsh's ToolCallViewProps, narrowed). */
export interface CardProps {
  phase: 'preparing' | 'start' | 'result'
  callId: string
  block: {
    argsRaw?: string
    call?: { argsRaw: string } | null
    meta?: unknown
    isError?: boolean
    error?: { code: string }
  }
  inputActions?: InputActions
  sessionId?: string
}

function parseArgs(raw: string | undefined): Args {
  try {
    const value: unknown = JSON.parse(raw ?? '')
    return typeof value === 'object' && value !== null ? (value as Args) : {}
  } catch {
    return {}
  }
}

const STATUS: Record<Decision, { text: string; tone: 'yes' | 'no' }> = {
  approved: { text: 'Approved', tone: 'yes' },
  changed: { text: 'Approved with changes', tone: 'yes' },
  rejected: { text: 'Rejected', tone: 'no' },
}

/** The card for one `request_approval` call. */
export function ApprovalCard(props: CardProps) {
  ensureStyle()
  if (props.phase === 'preparing') {
    return (
      <div className="dsh-apr">
        <div className="dsh-apr-strip" data-tone="quiet">
          <span className="dsh-apr-dot" />
          Preparing an approval request…
        </div>
      </div>
    )
  }
  const raw = props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw
  const args = parseArgs(raw)
  const result = props.phase === 'result' ? (props.block.meta as Result | undefined) : undefined
  if (props.phase === 'result' && (props.block.isError || !result)) {
    return (
      <div className="dsh-apr">
        <div className="dsh-apr-strip" data-tone="quiet">
          <span className="dsh-apr-dot" />
          Approval request for “{args.action ?? 'an action'}” was cancelled
        </div>
      </div>
    )
  }
  if (result && result.status !== 'pending') return <Decided args={args} result={result} />
  return <Undecided {...props} args={args} raw={raw} pending={result?.status === 'pending'} />
}

/** Undecided as far as the tool knows: unless a later reply message decided it, ask. */
function Undecided(props: CardProps & { args: Args; raw: string | undefined; pending: boolean }) {
  const late = useSyncExternalStore(subscribe, () => decidedReply(props.callId))
  const { args, raw } = props
  if (late) {
    const fields = late.decision === 'changed' ? late : args
    const result: Result = {
      approval: late.approval,
      status: late.decision,
      ...(fields.target === undefined ? {} : { target: fields.target }),
      ...(fields.subject === undefined ? {} : { subject: fields.subject }),
      ...(fields.content === undefined ? {} : { content: fields.content }),
      ...(late.comment ? { comment: late.comment } : {}),
    }
    return <Decided args={args} result={result} />
  }
  return (
    <Ask
      key={raw ?? ''}
      approval={props.callId}
      args={args}
      pending={props.pending}
      {...(props.inputActions ? { actions: props.inputActions } : {})}
      {...(props.sessionId ? { sessionId: props.sessionId } : {})}
    />
  )
}

/** The container above the session's message box that undecided approvals are drawn into. */
function dockFor(sessionId: string | undefined): HTMLElement | null {
  const scope = sessionId
    ? document.querySelector(`[data-conversation-session="${CSS.escape(sessionId)}"]`)
    : document
  const seat = scope?.querySelector('[data-composer-seat]')
  if (!seat) return null
  let dock = seat.querySelector<HTMLElement>(':scope > .dsh-apr-dock')
  if (!dock) {
    dock = document.createElement('div')
    dock.className = 'dsh-apr-dock'
    seat.prepend(dock)
  }
  return dock
}

/**
 * Draws its children in the dock above the message box: a finished turn folds its tool calls away,
 * and an approval still waiting for the user must stay in sight, as dsh's own questions do.
 */
function Docked({ sessionId, children }: { sessionId?: string; children: ReactNode }) {
  const [dock, setDock] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const find = (): void => {
      const found = dockFor(sessionId)
      setDock((current) => (current?.isConnected ? current : found))
    }
    find()
    const timer = setInterval(find, 1000)
    return () => clearInterval(timer)
  }, [sessionId])
  return dock ? createPortal(children, dock) : <>{children}</>
}

function Decided({ args, result }: { args: Args; result: Result }) {
  const status = STATUS[result.status as Decision]
  return (
    <div className="dsh-apr">
      <div className="dsh-apr-strip" data-tone={status.tone}>
        <span className="dsh-apr-dot" />
        <span className="dsh-apr-action">{status.text}</span>
        <span>· {args.action}</span>
      </div>
      <div className="dsh-apr-body">
        {result.target !== undefined && <Shown label="Target" text={result.target} />}
        {result.subject !== undefined && <Shown label="Subject" text={result.subject} />}
        {result.content !== undefined && result.status !== 'rejected' && (
          <Shown label="Content" text={result.content} block />
        )}
        {result.comment && <Shown label="Your comment" text={result.comment} />}
      </div>
      <div className="dsh-apr-foot" />
    </div>
  )
}

function Shown({ label, text, block }: { label: string; text: string; block?: boolean }) {
  return (
    <div className="dsh-apr-field">
      <span className="dsh-apr-label">{label}</span>
      {block ? <pre className="dsh-apr-pre">{text}</pre> : <span>{text}</span>}
    </div>
  )
}

function Ask(props: {
  approval: string
  args: Args
  pending: boolean
  actions?: InputActions
  sessionId?: string
}) {
  const { args } = props
  const [target, setTarget] = useState(args.target ?? '')
  const [subject, setSubject] = useState(args.subject ?? '')
  const [content, setContent] = useState(args.content ?? '')
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState<Decision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changed =
    target !== (args.target ?? '') ||
    subject !== (args.subject ?? '') ||
    content !== (args.content ?? '')

  const send = (decision: Decision): void => {
    if (!props.actions) {
      setError('This view cannot send; answer from the session’s chat.')
      return
    }
    const reply: Reply = {
      approval: props.approval,
      decision,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...(decision === 'changed'
        ? {
            content,
            ...(args.target !== undefined || target ? { target } : {}),
            ...(args.subject !== undefined || subject ? { subject } : {}),
          }
        : {}),
    }
    props.actions.setDraft(formatReply(reply))
    props.actions.submit()
    setSent(decision)
  }

  if (sent) {
    return (
      <div className="dsh-apr">
        <div className="dsh-apr-strip" data-tone={STATUS[sent].tone}>
          <span className="dsh-apr-dot" />
          <span className="dsh-apr-action">{STATUS[sent].text}</span>
          <span>· sent, waiting for the agent</span>
        </div>
      </div>
    )
  }
  const lines = Math.min(18, Math.max(4, content.split('\n').length + 1))
  const note = (
    <div className="dsh-apr">
      <div className="dsh-apr-strip" data-tone="ask">
        <span className="dsh-apr-dot" />
        <span className="dsh-apr-action">Approval needed</span>
        <span>· {args.action ?? 'Action'} · answer above the message box</span>
      </div>
    </div>
  )
  const form = (
    <div className="dsh-apr">
      <div className="dsh-apr-strip" data-tone="ask">
        <span className="dsh-apr-dot" />
        <span className="dsh-apr-action">Approval needed</span>
        <span>· {args.action ?? 'Action'}</span>
      </div>
      <div className="dsh-apr-body">
        {args.why && <p className="dsh-apr-why">{args.why}</p>}
        {(args.target !== undefined || target) && (
          <label className="dsh-apr-field">
            <span className="dsh-apr-label">Target</span>
            <input
              className="dsh-apr-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
        )}
        {(args.subject !== undefined || subject) && (
          <label className="dsh-apr-field">
            <span className="dsh-apr-label">Subject</span>
            <input
              className="dsh-apr-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
        )}
        <label className="dsh-apr-field">
          <span className="dsh-apr-label">Content</span>
          <textarea
            className="dsh-apr-text"
            rows={lines}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        {args.details && (
          <details className="dsh-apr-details">
            <summary>Details</summary>
            <pre className="dsh-apr-pre">{args.details}</pre>
          </details>
        )}
        <label className="dsh-apr-field">
          <span className="dsh-apr-label">Comment (optional)</span>
          <textarea
            className="dsh-apr-input"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
      </div>
      <div className="dsh-apr-foot">
        <span className="dsh-apr-note">
          {error ? (
            <span className="dsh-apr-error">{error}</span>
          ) : props.pending ? (
            'The agent moved on; your decision will reach it as a message.'
          ) : null}
        </span>
        <span className="dsh-apr-buttons">
          <Button variant="outline" onClick={() => send('rejected')}>
            Reject
          </Button>
          <Button variant="primary" onClick={() => send(changed ? 'changed' : 'approved')}>
            {changed ? 'Approve with changes' : 'Approve'}
          </Button>
        </span>
      </div>
    </div>
  )
  return (
    <>
      {note}
      <Docked {...(props.sessionId ? { sessionId: props.sessionId } : {})}>{form}</Docked>
    </>
  )
}
