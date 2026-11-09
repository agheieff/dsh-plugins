import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { formatReply } from '../src/marker.ts'

type Listener = (...args: unknown[]) => unknown

/** A stand-in for dsh's context: captures the tool and the two agent listeners. */
function harness(hook: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'approval-'))
  const listeners = new Map<string, Listener>()
  let tool: { execute: Listener; output: { render: Listener } } | undefined
  const ctx = {
    tools: { register: (def: typeof tool) => (tool = def) },
    on: (name: string, fn: Listener) => listeners.set(name, fn),
    logger: { warn: () => {} },
  }
  apply(ctx as never, { hook, dir })
  const agent = { id: 'session-1' }
  const say = (id: string, text: string) =>
    listeners.get('agent/inbox/inserted')?.({
      agent,
      message: { id, content: [{ type: 'text', text }] },
    })
  const preStep = async (ids: string[]) => {
    const messages = ids.map((id) => ({ id, content: [] }))
    const decision = (await listeners.get('agent/pre-step')?.({ agent, messages }, async () => ({
      kind: 'enter',
      messages,
    }))) as { messages: { id: string }[] }
    return decision.messages.map((m) => m.id)
  }
  const ask = (callId: string, extra: object = {}) =>
    tool?.execute(
      {
        action: 'Send email',
        target: 'a@b.cz',
        subject: 'Hi',
        content: 'Hello',
        why: 'test',
        ...extra,
      },
      { callId, agent, signal: new AbortController().signal },
    ) as Promise<Record<string, unknown>>
  const records = () =>
    readFileSync(join(dir, 'approvals.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  return { ask, say, preStep, records, dir, render: (v: unknown) => tool?.output.render({}, v) }
}

describe('request_approval', () => {
  it('returns an in-window decision as the result and keeps the reply out of the next step', async () => {
    const h = harness()
    const result = h.ask('call-1')
    h.say(
      'm1',
      formatReply({
        approval: 'call-1',
        decision: 'changed',
        target: 'a@b.cz',
        subject: 'Hi',
        content: 'Hello!',
      }),
    )
    expect(await result).toEqual({
      approval: 'call-1',
      status: 'changed',
      target: 'a@b.cz',
      subject: 'Hi',
      content: 'Hello!',
    })
    expect(await h.preStep(['m1', 'm2'])).toEqual(['m2'])
    expect(h.records().map((r) => [r.kind, r.via])).toEqual([
      ['request', undefined],
      ['decision', 'tool'],
    ])
  })

  it('returns the asked fields on a plain approval', async () => {
    const h = harness()
    const result = h.ask('call-2')
    h.say('m1', formatReply({ approval: 'call-2', decision: 'approved' }))
    expect(await result).toMatchObject({ status: 'approved', target: 'a@b.cz', content: 'Hello' })
  })

  it('returns pending after the timeout, then lets the late reply reach the model once', async () => {
    const h = harness()
    expect(await h.ask('call-3', { timeout_seconds: 0.05 })).toEqual({
      approval: 'call-3',
      status: 'pending',
    })
    h.say('late', formatReply({ approval: 'call-3', decision: 'rejected', comment: 'not now' }))
    expect(await h.preStep(['late'])).toEqual(['late'])
    h.say('again', formatReply({ approval: 'call-3', decision: 'approved' }))
    expect(await h.preStep(['again'])).toEqual([])
    expect(h.records().map((r) => r.kind)).toEqual(['request', 'pending', 'decision', 'duplicate'])
  })

  it('tells the model what a pending result means', () => {
    const h = harness()
    expect(h.render({ approval: 'c', status: 'pending' })).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Do not do it yet') }),
    ])
  })

  it('gives every record to the hook command', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'hook-')), 'seen.jsonl')
    const script = join(tmpdir(), `hook-${process.pid}.sh`)
    writeFileSync(script, `#!/bin/sh\ncat >> ${out}\n`, { mode: 0o755 })
    const h = harness([script])
    const result = h.ask('call-4')
    h.say('m', formatReply({ approval: 'call-4', decision: 'approved' }))
    await result
    await new Promise((r) => setTimeout(r, 300))
    const seen = readFileSync(out, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l).kind)
    expect(seen).toEqual(['request', 'decision'])
  })
})
