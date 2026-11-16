import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Requests } from '../src/requests.ts'
import { answer } from '../src/route.ts'
import { type Runner, Store } from '../src/store.ts'
import { secretTool } from '../src/tool.ts'

const SECRET = 'sk-test-0123456789abcdef'

/** A stand-in for pass-cli and pi-secrets behind the `rpi` prefix. */
function fakeRemote(opts: { titles?: string[]; piFails?: boolean } = {}) {
  const pass = new Map<string, string>()
  const pi = new Map<string, string>()
  const argvs: string[][] = []
  const run: Runner = async (argv, stdin) => {
    argvs.push(argv)
    const [, tool, ...rest] = argv
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    if (tool === 'pass-cli' && rest[1] === 'list') {
      const titles = [...(opts.titles ?? []), ...pass.keys()]
      return ok(JSON.stringify({ items: titles.map((title) => ({ title, state: 'Active' })) }))
    }
    if (tool === 'pass-cli' && rest[1] === 'create') {
      const t = JSON.parse(stdin ?? '{}') as { title: string; password: string }
      pass.set(t.title, t.password)
      return ok()
    }
    if (tool === 'pass-cli' && rest[1] === 'view') {
      return ok(`${pass.get(rest[rest.indexOf('--item-title') + 1] ?? '') ?? ''}\n`)
    }
    if (tool === 'pi-secrets' && rest[0] === 'put') {
      if (opts.piFails) return { code: 1, stdout: '', stderr: 'locked' }
      pi.set(rest[1] ?? '', stdin ?? '')
      return ok()
    }
    if (tool === 'pi-secrets' && rest[0] === 'get') return ok(`${pi.get(rest[1] ?? '')}\n`)
    return { code: 1, stdout: '', stderr: 'unknown' }
  }
  return { run, pass, pi, argvs }
}

function harness(opts: Parameters<typeof fakeRemote>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-'))
  const remote = fakeRemote(opts)
  const requests = new Requests(dir)
  const store = new Store(remote.run, ['rpi'])
  const tool = secretTool(requests, store, 'Personal') as unknown as {
    execute: (args: object, exec: object) => Promise<Record<string, unknown>>
  }
  const controller = new AbortController()
  const ask = (callId: string, args: object = {}) =>
    tool.execute(
      { title: 'Test key', why: 'test', ...args },
      { callId, agent: { id: 's1' }, signal: controller.signal },
    )
  const log = () => readFileSync(join(dir, 'requests.jsonl'), 'utf8')
  const settle = () => new Promise((r) => setTimeout(r, 10))
  return { dir, remote, requests, store, ask, log, settle, controller }
}

describe('request_secret', () => {
  it('stores in Pass, a KEY= line and pi-secrets, and returns no value', async () => {
    const h = harness()
    const env = join(h.dir, 'app.env')
    writeFileSync(env, 'OTHER=1\nAPI_KEY=old\n')
    const result = h.ask('c1', { file: env, file_key: 'API_KEY', pi_secret: 'test-key' })
    await h.settle()
    const a = await answer(h.requests, h.store, { request: 'c1', secret: ` ${SECRET}\n` })
    expect(a.delivered).toBe(true)
    const outcome = await result
    expect(outcome).toMatchObject({ status: 'saved', length: SECRET.length })
    expect(outcome.fingerprint).toMatch(/^sha256:[0-9a-f]{12}$/)
    expect(h.remote.pass.get('Test key')).toBe(SECRET)
    expect(h.remote.pi.get('test-key')).toBe(SECRET)
    expect(readFileSync(env, 'utf8')).toBe(`OTHER=1\nAPI_KEY=${SECRET}\n`)
    expect(statSync(env).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
    expect(h.log()).not.toContain(SECRET)
    expect(h.remote.argvs.flat().join(' ')).not.toContain(SECRET)
  })

  it('refuses a title that already exists before asking', async () => {
    const h = harness({ titles: ['Test key'] })
    await expect(h.ask('c2')).rejects.toThrow(/already has an item/)
  })

  it('reports partial when one destination fails', async () => {
    const h = harness({ piFails: true })
    const result = h.ask('c3', { pi_secret: 'x' })
    await h.settle()
    await answer(h.requests, h.store, { request: 'c3', secret: SECRET })
    const outcome = await result
    expect(outcome.status).toBe('partial')
    expect(outcome.stored).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, error: 'locked' }),
    ])
  })

  it('declines, then refuses a second answer', async () => {
    const h = harness()
    const result = h.ask('c4')
    await h.settle()
    await answer(h.requests, h.store, { request: 'c4', decline: true, comment: 'later' })
    expect(await result).toMatchObject({ status: 'declined', comment: 'later' })
    expect((await answer(h.requests, h.store, { request: 'c4', secret: SECRET })).error).toMatch(
      /already answered/,
    )
  })

  it('returns pending after the timeout and still stores a late answer', async () => {
    const h = harness()
    expect(await h.ask('c5', { timeout_seconds: 0.02 })).toMatchObject({ status: 'pending' })
    const late = await answer(h.requests, h.store, { request: 'c5', secret: SECRET })
    expect(late).toMatchObject({ delivered: false, outcome: { status: 'saved' } })
    // A restarted host reads the log and knows the outcome.
    expect(new Requests(h.dir).outcome('c5')?.status).toBe('saved')
  })

  it('refuses answers to a cancelled request', async () => {
    const h = harness()
    const result = h.ask('c6')
    await h.settle()
    h.controller.abort()
    await expect(result).rejects.toBeDefined()
    expect((await answer(h.requests, h.store, { request: 'c6', secret: SECRET })).error).toMatch(
      /cancelled/,
    )
  })
})
