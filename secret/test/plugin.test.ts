import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Requests } from '../src/requests.ts'
import { answer } from '../src/route.ts'
import { type Runner, Store, type StoreConfig, validate } from '../src/store.ts'
import { secretTool } from '../src/tool.ts'

const SECRET = 'sk-test-0123456789abcdef'

/** Two configured stores: `vault` (always, with a uniqueness check) and `kv` (on request). */
const STORES: StoreConfig[] = [
  {
    id: 'vault',
    label: 'Vault: {vault} / {title}',
    description: 'the password manager',
    always: true,
    fields: [
      { name: 'vault', description: 'Vault name.', default: 'Main' },
      { name: 'url', description: 'Website.' },
    ],
    check: ['vault', 'check', '{vault}', '{title}'],
    put: ['vault', 'put', '{vault}', '{title}', '{url}'],
    get: ['vault', 'get', '{vault}', '{title}'],
  },
  {
    id: 'kv',
    label: 'kv: {kv_name}',
    description: 'the service secret store',
    fields: [{ name: 'kv_name', description: 'Name in the store.' }],
    put: ['kv', 'put', '{kv_name}'],
    get: ['kv', 'get', '{kv_name}'],
  },
]

/** A stand-in for the two stores' commands. */
function fakeRemote(opts: { titles?: string[]; kvFails?: boolean } = {}) {
  const vault = new Map<string, string>()
  const kv = new Map<string, string>()
  const argvs: string[][] = []
  const run: Runner = async (argv, stdin) => {
    argvs.push(argv)
    const [tool, op, a = '', b = ''] = argv
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    if (tool === 'vault' && op === 'check') {
      const taken = [...(opts.titles ?? []), ...vault.keys()].includes(`${a}/${b}`)
      return taken ? { code: 1, stdout: '', stderr: 'already has an item' } : ok()
    }
    if (tool === 'vault' && op === 'put') {
      vault.set(`${a}/${b}`, stdin ?? '')
      return ok()
    }
    if (tool === 'vault' && op === 'get') return ok(`${vault.get(`${a}/${b}`) ?? ''}\n`)
    if (tool === 'kv' && op === 'put') {
      if (opts.kvFails) return { code: 1, stdout: '', stderr: 'locked' }
      kv.set(a, stdin ?? '')
      return ok()
    }
    if (tool === 'kv' && op === 'get') return ok(`${kv.get(a)}\n`)
    return { code: 1, stdout: '', stderr: 'unknown' }
  }
  return { run, vault, kv, argvs }
}

function harness(opts: Parameters<typeof fakeRemote>[0] = {}, stores = STORES) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-'))
  const remote = fakeRemote(opts)
  const requests = new Requests(dir)
  const store = new Store(remote.run, stores, true)
  const tool = secretTool(requests, store) as unknown as {
    description: string
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
  return { dir, remote, requests, store, tool, ask, log, settle, controller }
}

describe('request_secret', () => {
  it('stores in every chosen place, a KEY= line included, and returns no value', async () => {
    const h = harness()
    const env = join(h.dir, 'app.env')
    writeFileSync(env, 'OTHER=1\nAPI_KEY=old\n')
    const result = h.ask('c1', { file: env, file_key: 'API_KEY', kv_name: 'test-key' })
    await h.settle()
    const a = await answer(h.requests, h.store, { request: 'c1', secret: ` ${SECRET}\n` })
    expect(a.delivered).toBe(true)
    const outcome = await result
    expect(outcome).toMatchObject({ status: 'saved', length: SECRET.length })
    expect(outcome.fingerprint).toMatch(/^sha256:[0-9a-f]{12}$/)
    expect(h.remote.vault.get('Main/Test key')).toBe(SECRET)
    expect(h.remote.kv.get('test-key')).toBe(SECRET)
    expect(outcome.stored).toEqual([
      { where: 'Vault: Main / Test key', ok: true },
      { where: 'kv: test-key', ok: true },
      { where: `${env} (API_KEY)`, ok: true },
    ])
    expect(readFileSync(env, 'utf8')).toBe(`OTHER=1\nAPI_KEY=${SECRET}\n`)
    expect(statSync(env).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(outcome)).not.toContain(SECRET)
    expect(h.log()).not.toContain(SECRET)
    expect(h.remote.argvs.flat().join(' ')).not.toContain(SECRET)
  })

  it('refuses before asking when a store check fails', async () => {
    const h = harness({ titles: ['Other/Test key'] })
    await expect(h.ask('c2', { vault: 'Other' })).rejects.toThrow(
      /^Vault: Other \/ Test key: already has an item$/,
    )
    expect(h.remote.argvs[0]).toEqual(['vault', 'check', 'Other', 'Test key'])
  })

  it('needs at least one place, and lists the configured ones for the model', async () => {
    const h = harness({}, STORES.slice(1))
    await expect(h.ask('c7')).rejects.toThrow(/no destination/)
    expect(h.tool.description).toContain('- kv (when you give `kv_name`): the service secret store')
    expect(h.tool.description).toContain('- file (when you give `file`)')
  })

  it('rejects clashing field names', () => {
    const clash = { ...STORES[1], id: 'kv2' } as StoreConfig
    expect(() => validate([...STORES, clash])).toThrow(/kv_name is taken/)
    expect(() => validate([{ ...clash, fields: [{ name: 'title', description: '' }] }])).toThrow()
  })

  it('reports partial when one destination fails', async () => {
    const h = harness({ kvFails: true })
    const result = h.ask('c3', { kv_name: 'x' })
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
