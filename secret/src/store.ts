import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { Spec, Stored } from './spec.ts'

export interface Run {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs one command; the secret, when there is one, only ever travels on stdin. */
export type Runner = (argv: string[], stdin?: string) => Promise<Run>

export const spawnRunner: Runner = (argv, stdin) =>
  new Promise((resolve) => {
    const [command, ...args] = argv
    if (!command) return resolve({ code: 1, stdout: '', stderr: 'empty command' })
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    child.on('error', (e) => resolve({ code: 1, stdout, stderr: e.message }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(stdin ?? '')
  })

export function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

/** stderr without pass-cli's harmless mlock warnings, short, and never containing the value. */
function reason(run: Run, value?: string): string {
  const text = run.stderr
    .split('\n')
    .filter((l) => l.trim() && !l.includes('sqlcipher_mlock'))
    .join(' ')
    .slice(0, 300)
  const clean = value ? text.split(value).join('<secret>') : text
  return clean || `exit ${run.code}`
}

const same = (read: string, value: string): boolean => read.replace(/\r?\n$/, '') === value

/** Stores and checks the secret in each destination, Pass first. Never throws. */
export class Store {
  constructor(
    private readonly run: Runner,
    /** Command prefix reaching the container (where pass-cli and pi-secrets live). */
    private readonly remote: string[],
  ) {}

  /** Problems that should stop the request before the user types anything. */
  async preflight(spec: Spec): Promise<string | undefined> {
    if (spec.file && !isAbsolute(spec.file)) return `file must be an absolute path: ${spec.file}`
    if (spec.file_key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.file_key)) {
      return `file_key must be a variable name: ${spec.file_key}`
    }
    if (spec.file_key && !spec.file) return 'file_key needs file'
    const list = await this.run([
      ...this.remote,
      'pass-cli',
      'item',
      'list',
      '--vault-name',
      spec.vault,
      '--output',
      'json',
    ])
    if (list.code !== 0) return `Proton Pass is not reachable: ${reason(list)}`
    try {
      const items = (JSON.parse(list.stdout) as { items: { title: string; state: string }[] }).items
      if (items.some((i) => i.title === spec.title && i.state === 'Active')) {
        return `Proton Pass already has an item titled “${spec.title}” in ${spec.vault}; use another title or the existing item`
      }
    } catch {
      return 'Proton Pass returned an unreadable item list'
    }
    return undefined
  }

  async save(spec: Spec, value: string): Promise<Stored[]> {
    const results = [await this.pass(spec, value)]
    if (spec.file) results.push(this.file(spec.file, spec.file_key, value))
    if (spec.pi_secret) results.push(await this.piSecret(spec.pi_secret, value))
    return results
  }

  private async pass(spec: Spec, value: string): Promise<Stored> {
    const where = `Proton Pass: ${spec.vault} / ${spec.title}`
    const template = JSON.stringify({
      title: spec.title,
      username: spec.username ?? null,
      email: null,
      password: value,
      totp_uri: null,
      urls: spec.url ? [spec.url] : [],
    })
    const pass = [...this.remote, 'pass-cli', 'item']
    const made = await this.run(
      [...pass, 'create', 'login', '--vault-name', spec.vault, '--from-template', '-'],
      template,
    )
    if (made.code !== 0) return { where, ok: false, error: reason(made, value) }
    const read = await this.run([
      ...pass,
      'view',
      '--vault-name',
      spec.vault,
      '--item-title',
      spec.title,
      '--field',
      'password',
    ])
    if (read.code !== 0 || !same(read.stdout, value)) {
      return { where, ok: false, error: 'created, but reading it back did not match' }
    }
    return { where, ok: true }
  }

  private file(path: string, key: string | undefined, value: string): Stored {
    const where = key ? `${path} (${key})` : path
    try {
      if (/[\r\n]/.test(value) && key) throw new Error('a multi-line value cannot be a KEY= line')
      let text = `${value}\n`
      if (key) {
        let old = ''
        try {
          old = readFileSync(path, 'utf8')
        } catch {}
        const lines = old.split('\n').filter((l, i, all) => !(i === all.length - 1 && l === ''))
        const at = lines.findIndex((l) => l.startsWith(`${key}=`))
        if (at >= 0) lines[at] = `${key}=${value}`
        else lines.push(`${key}=${value}`)
        text = `${lines.join('\n')}\n`
      }
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp-${process.pid}`
      writeFileSync(tmp, text, { mode: 0o600 })
      renameSync(tmp, path)
      if (readFileSync(path, 'utf8') !== text) throw new Error('reading it back did not match')
      return { where, ok: true }
    } catch (error) {
      return {
        where,
        ok: false,
        error: String((error as Error).message)
          .split(value)
          .join('<secret>'),
      }
    }
  }

  private async piSecret(name: string, value: string): Promise<Stored> {
    const where = `pi-secrets: ${name}`
    const put = await this.run([...this.remote, 'pi-secrets', 'put', name], value)
    if (put.code !== 0) return { where, ok: false, error: reason(put, value) }
    const read = await this.run([...this.remote, 'pi-secrets', 'get', name])
    if (read.code !== 0 || !same(read.stdout, value)) {
      return { where, ok: false, error: 'stored, but reading it back did not match' }
    }
    return { where, ok: true }
  }
}
