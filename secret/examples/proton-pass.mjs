#!/usr/bin/env node
// A request_secret store for Proton Pass, through pass-cli. Usage:
//   proton-pass.mjs [cli...] -- check <vault> <title>       refuse if Pass is unreachable or the title exists
//   proton-pass.mjs [cli...] -- put <vault> <title> [username] [url]   secret on stdin
//   proton-pass.mjs [cli...] -- get <vault> <title>         print the stored password
// [cli...] is the command that runs pass-cli (default `pass-cli`; e.g. `ssh host pass-cli`).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
const cli = split > 0 ? argv.slice(0, split) : ['pass-cli']
const [command, vault, title, username, url] = split >= 0 ? argv.slice(split + 1) : argv

function pass(args, input) {
  const r = spawnSync(cli[0], [...cli.slice(1), ...args], { input: input ?? '', encoding: 'utf8' })
  // pass-cli warns about mlock on every call; that is not an error.
  const stderr = (r.stderr ?? '')
    .split('\n')
    .filter((l) => l.trim() && !l.includes('sqlcipher_mlock'))
    .join(' ')
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: stderr || r.error?.message || '' }
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (!vault || !title) fail('usage: proton-pass.mjs [cli...] -- check|put|get <vault> <title>')

if (command === 'check') {
  const list = pass(['item', 'list', '--vault-name', vault, '--output', 'json'])
  if (list.code !== 0) fail(`Proton Pass is not reachable: ${list.stderr || `exit ${list.code}`}`)
  let items
  try {
    items = JSON.parse(list.stdout).items
  } catch {
    fail('Proton Pass returned an unreadable item list')
  }
  if (items.some((i) => i.title === title && i.state === 'Active')) {
    fail(`Proton Pass already has an item titled “${title}” in ${vault}; use another title`)
  }
} else if (command === 'put') {
  const password = readFileSync(0, 'utf8')
  const template = JSON.stringify({
    title,
    username: username || null,
    email: null,
    password,
    totp_uri: null,
    urls: url ? [url] : [],
  })
  const made = pass(
    ['item', 'create', 'login', '--vault-name', vault, '--from-template', '-'],
    template,
  )
  if (made.code !== 0) fail(made.stderr.split(password).join('<secret>') || `exit ${made.code}`)
} else if (command === 'get') {
  const read = pass([
    'item',
    'view',
    '--vault-name',
    vault,
    '--item-title',
    title,
    '--field',
    'password',
  ])
  if (read.code !== 0) fail(read.stderr || `exit ${read.code}`)
  process.stdout.write(read.stdout)
} else {
  fail(`unknown command: ${command}`)
}
