/** What a `request_secret` call asks for and where the secret goes. No secret value lives here. */
export interface Spec {
  /** What the secret is; also `{title}` in store commands. */
  title: string
  why: string
  /** Where or how the user gets the secret (URL, steps). */
  how?: string
  /** Absolute host path to write the secret to (0600). */
  file?: string
  /** With `file`: write or replace one `KEY=value` line instead of the whole file. */
  file_key?: string
  /** Configured stores this request uses, by id. */
  stores: string[]
  /** Store field values (defaults filled in), by field name. */
  fields: Record<string, string>
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
