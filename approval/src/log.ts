import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** One line of `approvals.jsonl`; also what the hook command receives on stdin. */
export interface ApprovalRecord {
  kind: 'request' | 'decision' | 'pending' | 'duplicate'
  approval: string
  at: string
  [field: string]: unknown
}

/**
 * Every request and decision, appended to `<dir>/approvals.jsonl`; each record is also given to the
 * configured hook command (as JSON on stdin), so a deployment can file decisions wherever it keeps
 * them without this plugin knowing where.
 */
export class ApprovalLog {
  private readonly decided = new Set<string>()
  private readonly path: string

  constructor(
    dir: string,
    private readonly hook: readonly string[],
    private readonly warn: (message: string) => void,
  ) {
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'approvals.jsonl')
    try {
      for (const line of readFileSync(this.path, 'utf8').split('\n')) {
        if (!line) continue
        const record = JSON.parse(line) as ApprovalRecord
        if (record.kind === 'decision') this.decided.add(record.approval)
      }
    } catch {}
  }

  isDecided(approval: string): boolean {
    return this.decided.has(approval)
  }

  write(record: Omit<ApprovalRecord, 'at'>): void {
    const full = { ...record, at: new Date().toISOString() } as ApprovalRecord
    if (full.kind === 'decision') this.decided.add(full.approval)
    appendFileSync(this.path, `${JSON.stringify(full)}\n`, { mode: 0o600 })
    this.runHook(full)
  }

  private runHook(record: ApprovalRecord): void {
    const [command, ...args] = this.hook
    if (!command) return
    try {
      const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], timeout: 60_000 })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => this.warn(`approval hook failed to start: ${error.message}`))
      child.on('close', (code) => {
        if (code !== 0) this.warn(`approval hook exited ${code}: ${stderr.trim().slice(0, 300)}`)
      })
      child.stdin.end(`${JSON.stringify(record)}\n`)
    } catch (error) {
      this.warn(`approval hook failed: ${String(error)}`)
    }
  }
}
