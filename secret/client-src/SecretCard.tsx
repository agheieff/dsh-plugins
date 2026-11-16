import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { lateMessage } from '../src/render.ts'
import type { Outcome, Spec } from '../src/spec.ts'
import { ensureStyle } from './style.ts'

/** Browser-relative routes (the page may sit under a base path). */
const SUBMIT = 'secret-request/submit'
const STATE = 'secret-request/state'

type Args = Partial<Spec> & { timeout_seconds?: number }

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
  }
  inputActions?: InputActions
  sessionId?: string
}

interface Answer {
  outcome?: Outcome
  delivered?: boolean
  error?: string
  destinations?: string[]
}

function parseArgs(raw: string | undefined): Args {
  try {
    const value: unknown = JSON.parse(raw ?? '')
    return typeof value === 'object' && value !== null ? (value as Args) : {}
  } catch {
    return {}
  }
}

function specOf(args: Args): Spec {
  return {
    title: args.title ?? 'a secret',
    why: args.why ?? '',
    stores: [],
    fields: {},
    ...args,
  }
}

function Strip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div className="dsh-sec-strip" data-tone={tone}>
      <span className="dsh-sec-dot" />
      {children}
    </div>
  )
}

/** The card for one `request_secret` call. */
export function SecretCard(props: CardProps) {
  ensureStyle()
  if (props.phase === 'preparing') {
    return (
      <div className="dsh-sec">
        <Strip tone="quiet">Preparing a secret request…</Strip>
      </div>
    )
  }
  const raw = props.phase === 'start' ? props.block.argsRaw : props.block.call?.argsRaw
  const args = parseArgs(raw)
  const result = props.phase === 'result' ? (props.block.meta as Outcome | undefined) : undefined
  if (props.phase === 'result' && (props.block.isError || !result)) {
    return (
      <div className="dsh-sec">
        <Strip tone="quiet">Secret request for “{args.title ?? 'a secret'}” did not go ahead</Strip>
      </div>
    )
  }
  if (result && result.status !== 'pending') return <Done outcome={result} />
  return <Open {...props} args={args} pending={result?.status === 'pending'} />
}

/** Not answered as far as the tool result knows; the host may know better (late answer, reload). */
function Open(props: CardProps & { args: Args; pending: boolean }) {
  const [known, setKnown] = useState<Answer | null>(null)
  useEffect(() => {
    let live = true
    fetch(`${STATE}?request=${encodeURIComponent(props.callId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : {}))
      .then((a) => live && setKnown(a))
      .catch(() => live && setKnown({}))
    return () => {
      live = false
    }
  }, [props.callId])
  if (known === null) return null
  if (known.outcome) return <Done outcome={known.outcome} />
  if (known.error) {
    return (
      <div className="dsh-sec">
        <Strip tone="quiet">
          Secret request for “{props.args.title}”: {known.error}
        </Strip>
      </div>
    )
  }
  return (
    <Ask
      request={props.callId}
      spec={specOf(props.args)}
      destinations={known.destinations ?? []}
      pending={props.pending}
      {...(props.inputActions ? { actions: props.inputActions } : {})}
      {...(props.sessionId ? { sessionId: props.sessionId } : {})}
    />
  )
}

function Done({ outcome }: { outcome: Outcome }) {
  const ok = outcome.status === 'saved'
  const label = outcome.status === 'declined' ? 'Declined' : ok ? 'Saved' : 'Saved with errors'
  return (
    <div className="dsh-sec">
      <Strip tone={outcome.status === 'declined' ? 'no' : ok ? 'yes' : 'ask'}>
        <span className="dsh-sec-strong">{label}</span>
        <span>· {outcome.title}</span>
        {outcome.fingerprint && <span className="dsh-sec-quiet">· {outcome.fingerprint}</span>}
      </Strip>
      {outcome.stored?.some((s) => !s.ok) && (
        <div className="dsh-sec-body">
          {outcome.stored.map((s) => (
            <div key={s.where} className={s.ok ? 'dsh-sec-quiet' : 'dsh-sec-error'}>
              {s.where}: {s.ok ? 'ok' : s.error}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The container above the session's message box that open requests are drawn into. */
function dockFor(sessionId: string | undefined): HTMLElement | null {
  const scope = sessionId
    ? document.querySelector(`[data-conversation-session="${CSS.escape(sessionId)}"]`)
    : document
  const seat = scope?.querySelector('[data-composer-seat]')
  if (!seat) return null
  let dock = seat.querySelector<HTMLElement>(':scope > .dsh-sec-dock')
  if (!dock) {
    dock = document.createElement('div')
    dock.className = 'dsh-sec-dock'
    seat.prepend(dock)
  }
  return dock
}

/** A finished turn folds its tool calls away; an open request must stay in sight. */
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

const isUrl = (text: string): boolean => /^https?:\/\/\S+$/.test(text.trim())

function Ask(props: {
  request: string
  spec: Spec
  destinations: string[]
  pending: boolean
  actions?: InputActions
  sessionId?: string
}) {
  const { spec } = props
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Outcome | null>(null)

  const post = async (decline: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(SUBMIT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          decline ? { request: props.request, decline } : { request: props.request, secret },
        ),
        cache: 'no-store',
      })
      const answer = (await response.json().catch(() => ({}))) as Answer
      if (!answer.outcome) {
        setError(answer.error ?? `failed (${response.status})`)
        return
      }
      setSecret('')
      setDone(answer.outcome)
      // Nothing waits any more (timed out, or dsh restarted): tell the model by message.
      if (!answer.delivered && props.actions) {
        props.actions.setDraft(lateMessage(answer.outcome))
        props.actions.submit()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Done outcome={done} />
  const note = (
    <div className="dsh-sec">
      <Strip tone="ask">
        <span className="dsh-sec-strong">Secret needed</span>
        <span>· {spec.title} · answer above the message box</span>
      </Strip>
    </div>
  )
  const form = (
    <div className="dsh-sec">
      <Strip tone="ask">
        <span className="dsh-sec-strong">Secret needed</span>
        <span>· {spec.title}</span>
      </Strip>
      <div className="dsh-sec-body">
        {spec.why && <p className="dsh-sec-why">{spec.why}</p>}
        {spec.how &&
          (isUrl(spec.how) ? (
            <a className="dsh-sec-link" href={spec.how.trim()} target="_blank" rel="noreferrer">
              {spec.how.trim()}
            </a>
          ) : (
            <p className="dsh-sec-why">{spec.how}</p>
          ))}
        <input
          className="dsh-sec-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste it here"
          value={secret}
          disabled={busy}
          onChange={(e) => setSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && secret.trim() && !busy) void post(false)
          }}
        />
        {props.destinations.length > 0 && (
          <div className="dsh-sec-quiet">Saved to {props.destinations.join(' · ')}</div>
        )}
      </div>
      <div className="dsh-sec-foot">
        <span className="dsh-sec-note">
          {error ? (
            <span className="dsh-sec-error">{error}</span>
          ) : busy ? (
            'Saving…'
          ) : props.pending ? (
            'The agent moved on; it will get a message once this is saved.'
          ) : null}
        </span>
        <span className="dsh-sec-buttons">
          <Button variant="outline" disabled={busy} onClick={() => void post(true)}>
            Decline
          </Button>
          <Button
            variant="primary"
            disabled={busy || !secret.trim()}
            onClick={() => void post(false)}
          >
            Save
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
