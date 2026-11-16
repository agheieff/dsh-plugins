import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Store, type StoreConfig, spawnRunner } from '../src/store.ts'

const HELPER = resolve(import.meta.dirname, '../examples/proton-pass.mjs')
const SECRET = 'sk-test-0123456789abcdef'

/** A fake pass-cli keeping items in a JSON file, enough for list/create/view. */
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs')
const db = process.argv[2]
const args = process.argv.slice(3)
const items = fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : {}
const opt = (name) => args[args.indexOf(name) + 1]
process.stderr.write('WARN sqlcipher_mlock: mlock() failed\\n')
if (args[1] === 'list') console.log(JSON.stringify({ items: Object.keys(items).map((title) => ({ title, state: 'Active' })) }))
else if (args[1] === 'create') { const t = JSON.parse(fs.readFileSync(0, 'utf8')); items[t.title] = t; fs.writeFileSync(db, JSON.stringify(items)) }
else if (args[1] === 'view') { const t = items[opt('--item-title')]; if (!t) process.exit(1); console.log(t.password) }
`

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pass-'))
  const cli = join(dir, 'pass-cli')
  writeFileSync(cli, FAKE)
  chmodSync(cli, 0o755)
  const db = join(dir, 'items.json')
  const via = [cli, db, '--']
  const config: StoreConfig = {
    id: 'pass',
    label: 'Proton Pass: {vault} / {title}',
    description: 'Proton Pass',
    always: true,
    fields: [
      { name: 'vault', description: 'Vault.', default: 'Personal' },
      { name: 'username', description: 'Account.' },
      { name: 'url', description: 'Website.' },
    ],
    check: ['node', HELPER, ...via, 'check', '{vault}', '{title}'],
    put: ['node', HELPER, ...via, 'put', '{vault}', '{title}', '{username}', '{url}'],
    get: ['node', HELPER, ...via, 'get', '{vault}', '{title}'],
  }
  return new Store(spawnRunner, [config], false)
}

describe('examples/proton-pass.mjs', () => {
  it('checks, stores and reads back; then refuses the same title', async () => {
    const store = setup()
    const spec = { title: 'Test key', why: 't', ...store.select({ url: 'https://x.test' }) }
    expect(await store.preflight(spec)).toBeUndefined()
    expect(await store.save(spec, SECRET)).toEqual([
      { where: 'Proton Pass: Personal / Test key', ok: true },
    ])
    expect(await store.preflight(spec)).toMatch(/already has an item titled “Test key”/)
  })
})
