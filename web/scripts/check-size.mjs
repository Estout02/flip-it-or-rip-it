#!/usr/bin/env node
// T037 / SC-002: the initial download (entry chunk + its static imports + their CSS) must stay
// ≤ 100 KB gzip, and must never contain the barcode decoder (it loads only on the first Scan tap).
// Also checks that the decoder wasm is emitted as a hashed asset on our own origin.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 100;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifestPath = join(dist, '.vite', 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error(`check-size: ${manifestPath} not found. Run \`vite build\` first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry && k.endsWith('index.html'));
if (!entryKey) {
  console.error('check-size: no index.html entry in the Vite manifest.');
  process.exit(1);
}

// Static imports only — dynamic imports (the scanner, the SW registration) are not initial.
const files = new Set(['index.html']);
const seen = new Set();
(function collect(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const chunk = manifest[key];
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  for (const imp of chunk.imports ?? []) collect(imp);
})(entryKey);

let failed = false;
let total = 0;
const rows = [];
for (const file of files) {
  const buf = readFileSync(join(dist, file));
  const gz = gzipSync(buf, { level: 9 }).length;
  total += gz;
  rows.push([file, gz]);
  if (file.endsWith('.js') && /zxing|barcode-detector/i.test(buf.toString('utf8'))) {
    console.error(`check-size: initial chunk ${file} contains the barcode decoder (zxing / barcode-detector).`);
    failed = true;
  }
}

for (const [file, gz] of rows) console.log(`  ${(gz / 1024).toFixed(1).padStart(6)} KB  ${file}`);
const kb = total / 1024;
console.log(`initial: ${kb.toFixed(1)} KB gzip (limit ${LIMIT_KB} KB)`);
if (kb > LIMIT_KB) {
  console.error(`check-size: over budget by ${(kb - LIMIT_KB).toFixed(1)} KB.`);
  failed = true;
}

const assets = readdirSync(join(dist, 'assets'));
const wasm = assets.filter((f) => f.endsWith('.wasm'));
if (wasm.length === 0) {
  console.error('check-size: the decoder .wasm was not emitted into dist/assets/ (it must be self-hosted).');
  failed = true;
} else {
  console.log(`scanner wasm (lazy, self-hosted): ${wasm.join(', ')}`);
}

// No third-party origin may be referenced by the shipped JS (CSP 'self'; no CDN for the wasm).
for (const f of assets.filter((a) => a.endsWith('.js'))) {
  const src = readFileSync(join(dist, 'assets', f), 'utf8');
  const cdn = src.match(/https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|fastly\.jsdelivr\.net)[^"'`\s]*/);
  if (cdn) console.warn(`check-size: note: ${f} still mentions ${cdn[0]} (overridden by locateFile at runtime).`);
}

process.exit(failed ? 1 : 0);
