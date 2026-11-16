# dsh plugins

Plugins for [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) web sessions. Built for and
tested on dsh 0.2.2-rc.3 (cordis 4.1).

| Plugin | Tool | What it does |
|---|---|---|
| [approval](approval/) | `request_approval` | The model asks the user to approve an action (email, payment, deletion …); the user approves, edits then approves, or rejects with a comment, in a card in the chat. |
| [secret](secret/) | `request_secret` | The model asks the user for a secret; the user pastes it into a card and the host stores it in configured places (password manager, secret store, env file). The model never sees the value. |

Each folder is a self-contained package:

```sh
cd approval        # or secret
pnpm install && pnpm test && pnpm build
pnpm pack          # then: dsh plugin --profile <profile> add <the .tgz>
```

`pnpm release` does all of that in one step (settings in `scripts/release.sh`).

MIT licensed.
