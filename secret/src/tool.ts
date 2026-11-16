import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderOutcome } from './render.ts'
import type { Requests } from './requests.ts'
import type { Outcome, Spec } from './spec.ts'
import type { Store } from './store.ts'

export const TOOL = 'request_secret'

export const DESCRIPTION = `Ask the user for a secret (API key, token, password, recovery code) without it entering the chat. The user sees a card with a password field, pastes the secret and confirms; the host stores it directly and you get back only where it was stored, a fingerprint and its length — never the value.

Use it whenever you need a secret from the user, instead of asking them to paste it into the chat or into a file by hand. It is always stored in Proton Pass (a login item titled \`title\`, in \`vault\`); add \`file\` (with \`file_key\` for a KEY=value line in an env file) and/or \`pi_secret\` for the place the program will read it from. Later, use the secret from there without printing it (pipe it, reference the file or env var).

\`title\` names the secret specifically ("DeepSeek API key — ds.agheieff.com"); it must not already exist in the vault. \`how\` tells the user where to get it (a URL, the menu path). \`why\` says in one line what it is for.

The result's status:
- saved: stored everywhere listed.
- partial: some destinations failed; read the errors.
- declined: the user did not give it; read their comment.
- pending: no answer within timeout_seconds. Continue with other work or end your turn; the outcome arrives later as a user message starting "Secret <id>:".`

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

export function secretTool(requests: Requests, store: Store, defaultVault: string) {
  return defineTool({
    name: TOOL,
    description: DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'What the secret is, specifically; the Proton Pass item title.',
      },
      why: { type: 'string', required: true, description: 'One line: what it is for.' },
      how: { type: 'string', description: 'Where or how the user gets it (URL, steps).' },
      vault: { type: 'string', description: `Proton Pass vault (default ${defaultVault}).` },
      username: { type: 'string', description: 'Account name for the Pass item, if any.' },
      url: { type: 'string', description: 'Website for the Pass item, if any.' },
      file: { type: 'string', description: 'Absolute path on this PC to write it to (0600).' },
      file_key: {
        type: 'string',
        description: 'With file: write or replace one KEY=value line instead of the whole file.',
      },
      pi_secret: { type: 'string', description: "Name in the container's pi-secrets store." },
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
      const request = String(exec.callId)
      const spec: Spec = {
        title: args.title.trim(),
        why: args.why,
        vault: args.vault?.trim() || defaultVault,
        ...(args.how ? { how: args.how } : {}),
        ...(args.username ? { username: args.username } : {}),
        ...(args.url ? { url: args.url } : {}),
        ...(args.file ? { file: args.file } : {}),
        ...(args.file_key ? { file_key: args.file_key } : {}),
        ...(args.pi_secret ? { pi_secret: args.pi_secret } : {}),
      }
      const problem = await store.preflight(spec)
      if (problem) throw new Error(problem)
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
