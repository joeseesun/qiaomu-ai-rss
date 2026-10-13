import { build, context } from 'esbuild';
import { compressedI18n } from './scripts/compress-i18n.mjs';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
const resolve = createRequire(import.meta.url);
const speechWebSocket = { name: 'desktop-speech-websocket', setup(build) {
  build.onResolve({ filter: /^ws$/ }, () => ({ path: resolve.resolve('ws', { paths: [resolve.resolve('@qiaomu/speech/speech')] }).replace(/index\.js$/, 'lib/websocket.js') }));
  build.onLoad({ filter: /node_modules[\\/]ws[\\/].*\.js$/ }, ({ path }) => ({ contents: readFileSync(path, 'utf8').replace(/require\('(events|https|http|net|tls|crypto|stream|url|buffer|zlib|util)'\)/g, "require('node:$1')"), loader: 'js' }));
} };
const projectLicense = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8');
const catalogLicense = readFileSync(new URL('./vendor/chinese-independent-blogs/LICENSE', import.meta.url), 'utf8');
const speechDir = resolve.resolve('@qiaomu/speech/speech').replace(/src[\\/]shared\.js$/, '');
const wsLicense = readFileSync(resolve.resolve('ws', { paths: [speechDir] }).replace(/index\.js$/, 'LICENSE'), 'utf8');
const speechEdgeLicense = readFileSync(speechDir + 'licenses/edge-tts-LGPL.txt', 'utf8');
const fontLicense = readFileSync(new URL('./fonts/OFL.txt', import.meta.url), 'utf8');
const turndownLicense = readFileSync(new URL('./node_modules/turndown/LICENSE', import.meta.url), 'utf8');
const turndownGfmLicense = readFileSync(new URL('./node_modules/turndown-plugin-gfm/LICENSE', import.meta.url), 'utf8');
// UTF-8 output avoids expanding bundled Chinese catalogs into Unicode escapes.
// Identifier minification keeps the eight-language tables within the 5 MB release budget; esbuild scopes renames safely inside the bundle.
const options = { entryPoints: ['src/main.ts'], bundle: true, minify: true, charset: 'utf8', loader: { '.woff2': 'dataurl', '.py': 'text' }, plugins: [speechWebSocket, compressedI18n], external: [...builtinModules, ...builtinModules.map(name => `node:${name}`), 'obsidian', '@codemirror/view', '@codemirror/state', 'electron', 'node:fs', 'node:path'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false, banner: { js: `/*! Qiaomu RSS — Copyright (c) 2026 向阳乔木; GPL-3.0-only.\nSource: https://github.com/joeseesun/qiaomu-ai-rss\n${projectLicense}\nTidings catalog: https://github.com/fuxiaoai/tidings-rss (CC0-1.0, metadata only)\nShared speech: https://github.com/joeseesun/qiaomu-audio (GPL-3.0-only). Edge interoperability LGPLv3; see shared dependency licenses/edge-tts-LGPL.txt. WebSocket adapter MIT\n${wsLicense}\nEdge interoperability LGPLv3\n${speechEdgeLicense}\nBlog catalog: https://github.com/timqian/chinese-independent-blogs\n${catalogLicense}\nBundled fonts: SIL OFL 1.1\n${fontLicense}\nlz-string: MIT\n${readFileSync(new URL('./node_modules/lz-string/LICENSE', import.meta.url), 'utf8')}\nTurndown: MIT\n${turndownLicense}\nTurndown GFM: MIT\n${turndownGfmLicense}*/` } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else {
  await build(options);
  for (const asset of ['main.js', 'styles.css']) {
    if (readFileSync(asset).byteLength > 5_000_000) throw new Error(`${asset} exceeds the 5 MB release budget`);
  }
}
