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

/** A tool parameter a store adds; `{name}` in its commands and label. */
export interface FieldConfig {
  name: string
  description: string
  default?: string
}

/**
 * A place secrets go, as commands. Each argv element may contain `{title}` and `{<field>}`
 * placeholders (an unset field is empty); they are substituted into the element, never through a
 * shell. The secret only travels on `put`'s stdin.
 */
export interface StoreConfig {
  id: string
  /** What the user and the model see, e.g. `Vault: {vault} / {title}`. */
  label: string
  /** For the model: what this place is and when to use it. */
  description: string
  /** Used on every request; otherwise only when one of its fields is given. */
  always?: boolean
  fields?: FieldConfig[]
  /** Runs before the user is asked; a non-zero exit refuses the request with its output. */
  check?: string[]
  /** Stores the secret, read from stdin. */
  put: string[]
  /** Prints the stored secret, to verify `put`. */
  get?: string[]
}

export const RESERVED = ['title', 'why', 'how', 'file', 'file_key', 'timeout_seconds']

/** Throws on a configuration that cannot work; called once at startup. */
export function validate(stores: StoreConfig[]): void {
  const ids = new Set<string>()
  const names = new Set(RESERVED)
  for (const s of stores) {
    if (ids.has(s.id)) throw new Error(`request_secret: duplicate store id ${s.id}`)
    ids.add(s.id)
    if (!s.put?.length) throw new Error(`request_secret: store ${s.id} has no put command`)
    for (const f of s.fields ?? []) {
      if (names.has(f.name)) throw new Error(`request_secret: field ${f.name} is taken`)
      names.add(f.name)
    }
  }
}

export function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

export function fill(template: string, spec: Pick<Spec, 'title' | 'fields'>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key === 'title' ? spec.title : (spec.fields[key] ?? ''),
  )
}

/** A command's error output, short, and never containing the value. */
function reason(run: Run, value?: string): string {
  const text = (run.stderr.trim() || run.stdout.trim()).replace(/\s+/g, ' ').slice(0, 300)
  const clean = value ? text.split(value).join('<secret>') : text
  return clean || `exit ${run.code}`
}

const same = (read: string, value: string): boolean => read.replace(/\r?\n$/, '') === value

/** Stores and checks the secret in each destination, in configured order. Never throws. */
export class Store {
  constructor(
    private readonly run: Runner,
    readonly stores: StoreConfig[],
    /** Whether the built-in `file` / `file_key` destination is offered. */
    readonly files: boolean,
  ) {}

  /** The stores a call uses and their field values (defaults filled in). */
  select(args: Record<string, unknown>): Pick<Spec, 'stores' | 'fields'> {
    const fields: Record<string, string> = {}
    const stores: string[] = []
    for (const s of this.stores) {
      const given = (s.fields ?? []).filter((f) => {
        const v = args[f.name]
        return typeof v === 'string' && v.trim() !== ''
      })
      if (!s.always && given.length === 0) continue
      stores.push(s.id)
      for (const f of s.fields ?? []) {
        const v = args[f.name]
        const value = typeof v === 'string' && v.trim() ? v.trim() : f.default
        if (value !== undefined) fields[f.name] = value
      }
    }
    return { stores, fields }
  }

  /** The destinations as the user sees them on the card. */
  destinations(spec: Spec): string[] {
    const list = this.chosen(spec).map((s) => fill(s.label, spec))
    if (spec.file) list.push(spec.file_key ? `${spec.file} (${spec.file_key}=…)` : spec.file)
    return list
  }

  private chosen(spec: Spec): StoreConfig[] {
    return this.stores.filter((s) => spec.stores.includes(s.id))
  }

  /** Problems that should stop the request before the user types anything. */
  async preflight(spec: Spec): Promise<string | undefined> {
    if (spec.file && !this.files) return 'file destinations are turned off'
    if (spec.file && !isAbsolute(spec.file)) return `file must be an absolute path: ${spec.file}`
    if (spec.file_key && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.file_key)) {
      return `file_key must be a variable name: ${spec.file_key}`
    }
    if (spec.file_key && !spec.file) return 'file_key needs file'
    if (!spec.file && spec.stores.length === 0) return 'no destination: name at least one place'
    for (const s of this.chosen(spec)) {
      if (!s.check) continue
      const run = await this.run(s.check.map((a) => fill(a, spec)))
      if (run.code !== 0) return `${fill(s.label, spec)}: ${reason(run)}`
    }
    return undefined
  }

  async save(spec: Spec, value: string): Promise<Stored[]> {
    const results: Stored[] = []
    for (const s of this.chosen(spec)) results.push(await this.command(s, spec, value))
    if (spec.file) results.push(this.file(spec.file, spec.file_key, value))
    return results
  }

  private async command(s: StoreConfig, spec: Spec, value: string): Promise<Stored> {
    const where = fill(s.label, spec)
    const put = await this.run(
      s.put.map((a) => fill(a, spec)),
      value,
    )
    if (put.code !== 0) return { where, ok: false, error: reason(put, value) }
    if (!s.get) return { where, ok: true }
    const read = await this.run(s.get.map((a) => fill(a, spec)))
    if (read.code !== 0 || !same(read.stdout, value)) {
      return { where, ok: false, error: 'stored, but reading it back did not match' }
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
}
