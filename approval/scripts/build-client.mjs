// Bundles client-src into dsh's browser-module format: one factory registered with the page's
// module loader, which supplies react and @deepseek-ai/* packages through `require`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const out = await build({
  entryPoints: ['client-src/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  write: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
})
const code = out.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code}
    return module.exports;
  }
});
`
mkdirSync('client', { recursive: true })
writeFileSync('client/client.js', wrapped)
console.log(`client/client.js: ${wrapped.length} bytes`)
