import { exec } from 'node:child_process';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { createFileStore } from '../src/store/fileStore.ts';
import { startServer } from '../src/store/server.ts';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const shouldOpen = args.includes('--open');
const fileArg = args.find(a => a !== '--open');
const projectPath = fileArg
  ? resolve(process.env.INIT_CWD ?? process.cwd(), fileArg)
  : join(ROOT, 'project.json');

await build({
  entryPoints: [join(ROOT, 'src/canvas/main.tsx')],
  outfile: join(ROOT, 'dist/app.js'),
  bundle: true,
  format: 'esm',
  sourcemap: 'inline',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  logLevel: 'warning',
});

const url = await startServer(createFileStore(projectPath), {
  html: join(ROOT, 'public/index.html'),
  css: join(ROOT, 'public/style.css'),
  js: join(ROOT, 'dist/app.js'),
}, 4173);

console.log(`Wiring Application: ${url}`);
console.log(`Project file: ${projectPath}`);

if (shouldOpen) {
  exec(process.platform === 'win32' ? `cmd /c start "" "${url}"` : `xdg-open "${url}"`);
}
