// Builds the claude.ai artifact: one self-contained page (scripts, styles and the studio mark
// inlined), written as page content for the Artifact skeleton. Output: dist-artifact/isida.html.
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-artifact';
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 7) ?? `art-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
await build({
  configFile: false,
  logLevel: 'warn',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    outDir: out,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { input: 'artifact.html' },
  },
});

const assets = join(out, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`expected one script, got ${js.join(', ')}`);
const script = readFileSync(join(assets, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

// Inside claude.ai the page frame already pads the top and bottom for the phone's bars.
const frame = `.composer{padding-bottom:10px}.page{padding-bottom:24px}.splash{padding-top:16px;padding-bottom:16px}`;
const page = `<title>Исида</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap">
<style>${css}${frame}</style>
<div id="app"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(out, 'isida.html'), page);
console.log(`dist-artifact/isida.html ${(page.length / 1024).toFixed(0)} KiB, build ${BUILD_ID}`);
