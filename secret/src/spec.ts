/** What a `request_secret` call asks for and where the secret goes. No secret value lives here. */
export interface Spec {
  /** What the secret is; also the Proton Pass item title. */
  title: string
  why: string
  /** Where or how the user gets the secret (URL, steps). */
  how?: string
  /** Proton Pass vault. */
  vault: string
  username?: string
  url?: string
  /** Absolute PC path to write the secret to (0600). */
  file?: string
  /** With `file`: write or replace one `KEY=value` line instead of the whole file. */
  file_key?: string
  /** Name in the container's pi-secrets store. */
  pi_secret?: string
}

/** One destination's outcome. */
export interface Stored {
  where: string
  ok: boolean
  error?: string
}

export type Status = 'saved' | 'partial' | 'declined' | 'pending'

/** What the tool returns and the card shows; never the value. */
export interface Outcome {
  request: string
  status: Status
  title: string
  stored?: Stored[]
  /** `sha256:` + first 12 hex digits of the value, for later checks. */
  fingerprint?: string
  length?: number
  comment?: string
}

/** The destinations as the user sees them on the card. */
export function destinations(spec: Spec): string[] {
  const list = [`Proton Pass: “${spec.title}” in ${spec.vault}`]
  if (spec.file) list.push(spec.file_key ? `${spec.file} (${spec.file_key}=…)` : spec.file)
  if (spec.pi_secret) list.push(`pi-secrets: ${spec.pi_secret}`)
  return list
}
