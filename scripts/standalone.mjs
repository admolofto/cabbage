// Packs the built app into one HTML file that runs when opened straight from
// disk, with no server. Browsers refuse to load separate script files from a
// file:// page, so the script, styles, and icon are all written inline.
//
// Run with: npm run build:standalone

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outFile = join(root, 'dist-standalone', 'cabbage.html');

let html = await readFile(join(dist, 'index.html'), 'utf8');
let inlined = 0;

async function replaceAsync(source, pattern, replacer) {
  const matches = [...source.matchAll(pattern)];
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let index = 0;
  return source.replace(pattern, () => replacements[index++]);
}

html = await replaceAsync(html, /<script\b[^>]*\bsrc="\.\/([^"]+)"[^>]*><\/script>/g, async (_, path) => {
  const code = await readFile(join(dist, path), 'utf8');
  inlined++;
  // A literal closing tag inside the code would end the script element early.
  return `<script type="module">${code.replaceAll('</script', '<\\/script')}</script>`;
});

html = await replaceAsync(html, /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/([^"]+)"[^>]*>/g, async (_, path) => {
  const css = await readFile(join(dist, path), 'utf8');
  inlined++;
  return `<style>${css.replaceAll('</style', '<\\/style')}</style>`;
});

html = await replaceAsync(html, /(<link\b[^>]*\brel="icon"[^>]*\bhref=")\.\/([^"]+)(")/g, async (_, before, path, after) => {
  const svg = await readFile(join(dist, path), 'utf8');
  inlined++;
  return `${before}data:image/svg+xml,${encodeURIComponent(svg)}${after}`;
});

const leftover = html.match(/(?:src|href)="\.\/[^"]+"/);
if (inlined < 2 || leftover) {
  throw new Error(`Standalone build is incomplete${leftover ? `: ${leftover[0]} was not inlined` : ''}.`);
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(`Wrote ${outFile} (${Math.round(html.length / 1024)} kB)`);
