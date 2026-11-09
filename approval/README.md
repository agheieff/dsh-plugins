# dsh-tool-approval

`request_approval` for dsh: any model asks the user to approve an action (an email, a payment, a
deletion …) and the user approves it, approves it with changes, or rejects it with a comment. The
rule to ask lives in the tool's instructions; nothing is blocked (full access otherwise).

- **Tool** (`src/tool.ts`): `action`, `target`, `subject`, `content` (exact final text), `why`,
  `details`, optional `timeout_seconds`. Without a timeout it waits for the answer; with one it
  returns `pending` when time runs out and the model goes on (other work or ends its turn).
  Results: `approved` / `changed` (use exactly the returned fields) / `rejected` (+ comment) /
  `pending`.
- **Card** (`client-src/`, bundled by `scripts/build-client.mjs` into dsh's browser-module format):
  dsh's per-tool card slot. While undecided, the form (editable target, subject, content; comment;
  Reject / Approve / Approve with changes) is docked above the message box, as dsh's questions are,
  because a finished turn folds its tool calls away; a short note stays inline. Decided: a compact
  result in the chat.
- **Answer path** (`src/marker.ts`): the card sends the decision as one chat message
  (`Approval <call id>: …` + JSON). While the tool waits, the host hands it to the tool and keeps the
  message out of the next step (`agent/inbox/inserted`, `agent/pre-step`); after a timeout the
  message reaches the model like a late answer to a dsh question. A user-text rule draws such a
  message as one line and tells the card the approval is decided.
- **Record** (`src/log.ts`): `~/.dsh/approvals/approvals.jsonl` gets every request, pending,
  decision and ignored duplicate; config `hook` (argv) receives each record as JSON on stdin, so a
  deployment files decisions wherever it keeps them:

  ```yaml
  - id: tool-request-approval
    name: '@agheieff/dsh-tool-approval'
    config:
      hook: [/path/to/command, --arg]
  ```

Known quirk: the card sends through the message box, so a half-typed draft there is replaced.

## Use

```sh
pnpm install && pnpm test
pnpm release   # test, build, pack, install the packed copy into the web profile with the pinned dsh, restart dsh-web
```

The PC's `dsh-web` service runs a pinned dsh (`~/.local/bin/dsh-pinned` → `~/.local/share/dsh/0.2.1-rc.2`), so
upgrading the global `dsh` changes nothing there; the web profile holds the packed copy
(`~/.local/share/dsh/plugins/*.tgz`), so work in this folder changes nothing until the next release.
