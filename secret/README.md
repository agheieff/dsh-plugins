# dsh-tool-secret

`request_secret` for dsh: a model asks the user for a secret (API key, token, password) and the
user pastes it into a card in the chat. The value goes straight from the card to the host, which
stores it; the model gets back only where it went, a fingerprint (`sha256:` + 12 hex) and the
length. The value never enters the conversation, a session log or this plugin's own log.

Where secrets go is configuration: any number of **stores**, each a few commands, plus a built-in
**file** destination (`file`, optional `file_key` for one `KEY=value` line; atomic, 0600).

- **Tool** (`src/tool.ts`): `title`, `why`, `how` (where to get it), the stores' fields, `file`,
  `file_key`, optional `timeout_seconds`. Its instructions list the configured places. Results:
  `saved` / `partial` (some destination failed) / `declined` / `pending`.
- **Stores** (`src/store.ts`): a store is used on every request (`always`) or when one of its
  fields is given. `check` runs before the user is asked (a non-zero exit refuses the request with
  its output), `put` gets the secret on stdin, `get` prints it back for comparison. The value
  travels only on stdin, never argv.
- **Route** (`src/route.ts`): `POST /secret-request/submit` and `GET /secret-request/state` on dsh's
  web server, behind dsh's Host/Origin fence and browser sign-in (`connection.requestRejection`).
- **Card** (`client-src/`): a password field docked above the message box while open. When no tool
  call waits any more (timeout, dsh restart) the card sends the outcome as a chat message
  (`Secret <id>: …`), which never contains the value.
- **Record**: `~/.dsh/secrets/requests.jsonl` (requests, destinations and outcomes; no values).

## Configuration

Each argv element may contain `{title}` and `{<field>}` placeholders, substituted into that
element (no shell; an unset field is empty). Field names are tool parameters, so they must be
unique and not one of `title`, `why`, `how`, `file`, `file_key`, `timeout_seconds`.

```yaml
- id: tool-request-secret
  name: '@agheieff/dsh-tool-secret'
  config:
    files: true                      # offer file / file_key (default true)
    stores:
      - id: pass
        label: 'Proton Pass: {vault} / {title}'
        description: Proton Pass, the user's password manager (a login item titled `title`).
        always: true
        fields:
          - { name: vault, description: Proton Pass vault., default: Personal }
          - { name: username, description: Account name for the item, if any. }
          - { name: url, description: Website for the item, if any. }
        check: [node, /path/to/proton-pass.mjs, pass-cli, --, check, '{vault}', '{title}']
        put: [node, /path/to/proton-pass.mjs, pass-cli, --, put, '{vault}', '{title}', '{username}', '{url}']
        get: [node, /path/to/proton-pass.mjs, pass-cli, --, get, '{vault}', '{title}']
      - id: pass-store
        label: 'pass: {pass_name}'
        description: the standard Unix password store, for programs that read `pass show`.
        fields:
          - { name: pass_name, description: 'Entry name in pass, e.g. api/openai.' }
        put: [pass, insert, --multiline, --force, '{pass_name}']
        get: [pass, show, '{pass_name}']
```

[`examples/proton-pass.mjs`](examples/proton-pass.mjs) is a Proton Pass store over `pass-cli`
(refuses a title that already exists; the words before `--` are the command that runs pass-cli, so
`ssh host pass-cli --` reaches another machine); it is tested against a stand-in pass-cli. The
`pass-store` entry is an untested sketch for the standard Unix `pass`. Without any store, only
`file` is available.

## Use

```sh
pnpm install && pnpm test
pnpm release   # test, build, pack, install the packed copy into a dsh profile (see scripts/release.sh)
```
