import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderOutcome } from './render.ts'
import type { Requests } from './requests.ts'
import type { Outcome, Spec } from './spec.ts'
import type { Store, StoreConfig } from './store.ts'

export const TOOL = 'request_secret'

function place(s: StoreConfig): string {
  const names = (s.fields ?? []).map((f) => `\`${f.name}\``)
  const when = s.always
    ? 'always'
    : names.length > 1
      ? `when you give ${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
      : `when you give ${names[0] ?? 'nothing (never used)'}`
  return `- ${s.id} (${when}): ${s.description}`
}

/** The tool's instructions, listing the places this host stores secrets in. */
export function description(store: Store): string {
  const places = store.stores.map(place)
  if (store.files) {
    places.push(
      '- file (when you give `file`): an absolute path on this host, written 0600; add `file_key` to write or replace one KEY=value line in an env file instead of the whole file.',
    )
  }
  return `Ask the user for a secret (API key, token, password, recovery code) without it entering the chat. The user sees a card with a password field, pastes the secret and confirms; the host stores it directly and you get back only where it was stored, a fingerprint and its length — never the value.

Use it whenever you need a secret from the user, instead of asking them to paste it into the chat or into a file by hand. Name the place the program will read it from. Later, use the secret from there without printing it (pipe it, reference the file or env var).

Places it is stored in (at least one must apply):
${places.join('\n')}

\`title\` names the secret specifically ("OpenAI API key — billing script"). \`how\` tells the user where to get it (a URL, the menu path). \`why\` says in one line what it is for.

The result's status:
- saved: stored everywhere listed.
- partial: some destinations failed; read the errors.
- declined: the user did not give it; read their comment.
- pending: no answer within timeout_seconds. Continue with other work or end your turn; the outcome arrives later as a user message starting "Secret <id>:".`
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    request: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['saved', 'partial', 'declined', 'pending'] },
    title: { type: 'string', required: true },
    stored: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          where: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
    },
    fingerprint: { type: 'string' },
    length: { type: 'number' },
    comment: { type: 'string' },
  },
} as const

interface StringParam {
  type: 'string'
  description: string
}

function storeParams(store: Store): Record<string, StringParam> {
  const params: Record<string, StringParam> = {}
  for (const s of store.stores) {
    for (const f of s.fields ?? []) {
      const fallback = f.default !== undefined ? ` (default ${f.default})` : ''
      params[f.name] = { type: 'string', description: `${s.id}: ${f.description}${fallback}` }
    }
  }
  if (store.files) {
    params.file = { type: 'string', description: 'Absolute path on this host to write it to.' }
    params.file_key = {
      type: 'string',
      description: 'With file: write or replace one KEY=value line instead of the whole file.',
    }
  }
  return params
}

export function secretTool(requests: Requests, store: Store) {
  return defineTool({
    name: TOOL,
    description: description(store),
    parameters: {
      title: { type: 'string', required: true, description: 'What the secret is, specifically.' },
      why: { type: 'string', required: true, description: 'One line: what it is for.' },
      how: { type: 'string', description: 'Where or how the user gets it (URL, steps).' },
      ...storeParams(store),
      timeout_seconds: {
        type: 'number',
        description: 'Optional: return "pending" after this long. Omit to wait for the answer.',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value as Outcome) }],
      presentationMeta: (_args, value) => value,
    },
    async execute(args, exec) {
      const raw = args as Record<string, unknown>
      const text = (key: string): string | undefined =>
        typeof raw[key] === 'string' && raw[key].trim() ? raw[key].trim() : undefined
      const file = text('file')
      const fileKey = text('file_key')
      const how = text('how')
      const spec: Spec = {
        title: args.title.trim(),
        why: args.why,
        ...(how ? { how } : {}),
        ...(file ? { file } : {}),
        ...(fileKey ? { file_key: fileKey } : {}),
        ...store.select(raw),
      }
      const problem = await store.preflight(spec)
      if (problem) throw new Error(problem)
      const request = String(exec.callId)
      requests.open(request, spec, exec.agent ? String(exec.agent.id) : undefined)
      const seconds = args.timeout_seconds
      return requests.wait(
        request,
        seconds && seconds > 0 ? seconds * 1000 : undefined,
        exec.signal,
      )
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Secret: ${args.title}`,
      kind: 'other',
      rawInput: args,
    }),
  })
}
