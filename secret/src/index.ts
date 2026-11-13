/**
 * `request_secret`: a model asks the user for a secret through a card in the chat. The card posts
 * the value to this plugin's route on dsh's own web server (same sign-in and Host/Origin fence as
 * the rest of dsh), which stores it in Proton Pass and any other named destination. The model gets
 * the destinations, a fingerprint and the length; the value never enters the conversation or a log.
 *
 * @module @agheieff/dsh-tool-secret
 */
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { Requests } from './requests.ts'
import { handlers, STATE_PATH, SUBMIT_PATH } from './route.ts'
import { Store, spawnRunner } from './store.ts'
import { secretTool } from './tool.ts'

export const name = 'tool-request-secret'
export const inject = ['tools', 'webServer', 'connection']

export interface Config {
  /** Default Proton Pass vault. */
  vault: string
  /** Command prefix that runs pass-cli and pi-secrets (in the Personal container). */
  remote: string[]
  /** Where requests.jsonl is kept. */
  dir?: string
}

export const Config: z<Config> = z.object({
  vault: z.string().default('Personal'),
  remote: z.array(z.string()).default(['rpi']),
  dir: z.string(),
})

interface Connection {
  requestRejection(req: IncomingMessage): number | undefined
}

export function apply(ctx: Context, config: Config): void {
  const requests = new Requests(config.dir ?? join(homedir(), '.dsh', 'secrets'))
  const store = new Store(spawnRunner, config.remote ?? ['rpi'])
  ctx.tools.register(secretTool(requests, store, config.vault ?? 'Personal'))
  // The connection service's package is browser-side, so it is read untyped (as dsh's own
  // open-in-app plugin does).
  const connection = Reflect.get(ctx, 'connection') as Connection
  const routes = handlers(requests, store, (req) => connection.requestRejection(req))
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'exact', path: SUBMIT_PATH, handler: routes.submit }),
  )
  ctx.effect(() =>
    ctx.webServer.register({ kind: 'exact', path: STATE_PATH, handler: routes.state }),
  )
}
