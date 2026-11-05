// Genera dist/asedio-demo.html: un solo archivo jugable sin servidor (público simulado).
// Uso: npm run build:demo            (Three.js desde CDN)
//      node tools/build-demo.mjs --local   (Three.js desde /vendor del servidor local, para pruebas)

import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageDir } from '../server/package-dir.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = process.argv.includes('--local');
const threeVersion = JSON.parse(await readFile(path.join(packageDir('three', ROOT), 'package.json'), 'utf8')).version;
const threeBase = local ? '/vendor/three/' : `https://cdn.jsdelivr.net/npm/three@${threeVersion}/`;

const result = await build({
  entryPoints: [path.join(ROOT, 'public/js/main.js')],
  bundle: true,
  format: 'esm',
  write: false,
  minify: true,
  target: 'es2020',
  external: ['three', 'three/addons/*'],
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(path.join(ROOT, 'public/css/style.css'), 'utf8');
const html = await readFile(path.join(ROOT, 'public/index.html'), 'utf8');
const app = html.slice(html.indexOf('<!--APP-->') + '<!--APP-->'.length, html.indexOf('<!--/APP-->'));

// Modelos .glb de /models incrustados en base64 (la página publicada no puede pedir archivos sueltos).
const modelDir = path.join(ROOT, 'models');
const models = {};
for (const f of (await readdir(modelDir)).filter((n) => n.endsWith('.glb')).sort()) {
  models[f.slice(0, -4)] = (await readFile(path.join(modelDir, f))).toString('base64');
}
const modelsKB = Object.values(models).reduce((a, b) => a + b.length, 0) / 1024;

// Sonidos .mp3 de public/sounds, también incrustados
const soundDir = path.join(ROOT, 'public', 'sounds');
const sounds = {};
for (const f of (await readdir(soundDir).catch(() => [])).filter((n) => n.endsWith('.mp3')).sort()) {
  sounds[f.slice(0, -4)] = (await readFile(path.join(soundDir, f))).toString('base64');
}
const soundsKB = Object.values(sounds).reduce((a, b) => a + b.length, 0) / 1024;

const importMap = JSON.stringify({
  imports: {
    three: `${threeBase}build/three.module.js`,
    'three/addons/': `${threeBase}examples/jsm/`,
  },
});

const page = `<title>Asedio LIVE</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
${css}
/* demo publicada: tema oscuro fijo y margen lateral seguro */
:root { color-scheme: dark; }
html, body { background: #04060c; color: #f2f5fb; }
#app {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 0;
}
</style>
<script type="importmap">${importMap}</script>
${app}
<script>window.ASEDIO_DEMO = true;</script>
<script>window.ASEDIO_MODELS = ${JSON.stringify(models)};</script>
<script>window.ASEDIO_SOUNDS = ${JSON.stringify(sounds)};</script>
<script type="module">${js}</script>
`;

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', local ? 'asedio-demo-local.html' : 'asedio-demo.html');
await writeFile(out, page);
console.log(`Demo generada: ${path.relative(ROOT, out)} (${(page.length / 1024).toFixed(0)} KB, de ellos ${modelsKB.toFixed(0)} KB de modelos (${Object.keys(models).join(', ')}) y ${soundsKB.toFixed(0)} KB de sonido (${Object.keys(sounds).length} archivos); three ${threeVersion})`);
