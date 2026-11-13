# dsh-tool-secret

`request_secret` for dsh: a model asks the user for a secret (API key, token, password) and the
user pastes it into a card in the chat. The value goes straight from the card to the host, which
stores it; the model gets back only where it went, a fingerprint (`sha256:` + 12 hex) and the
length. The value never enters the conversation, a session log or this plugin's own log.

- **Tool** (`src/tool.ts`): `title` (also the Proton Pass item title; must not exist yet), `why`,
  `how` (where to get it), `vault`, `username`, `url`, `file` + optional `file_key` (one
  `KEY=value` line), `pi_secret`, optional `timeout_seconds`. Results: `saved` / `partial` (some
  destination failed) / `declined` / `pending`.
- **Stores** (`src/store.ts`): always Proton Pass (`pass-cli item create login --from-template -`
  in the Personal container via `rpi`), then the file (atomic, 0600) and pi-secrets. Each is read
  back and compared. The value travels only on stdin, never argv.
- **Route** (`src/route.ts`): `POST /secret-request/submit` and `GET /secret-request/state` on dsh's
  web server, behind dsh's Host/Origin fence and browser sign-in (`connection.requestRejection`).
- **Card** (`client-src/`): a password field docked above the message box while open. When no tool
  call waits any more (timeout, dsh restart) the card sends the outcome as a chat message
  (`Secret <id>: …`), which never contains the value.
- **Record**: `~/.dsh/secrets/requests.jsonl` (requests, destinations and outcomes; no values).

## Use

```sh
pnpm install && pnpm test
pnpm release   # test, build, pack, install into the web profile with the pinned dsh, restart dsh-web
```
