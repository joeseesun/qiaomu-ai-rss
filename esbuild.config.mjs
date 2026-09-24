import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
const projectLicense = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8');
const catalogLicense = readFileSync(new URL('./vendor/chinese-independent-blogs/LICENSE', import.meta.url), 'utf8');
const fontLicense = readFileSync(new URL('./fonts/OFL.txt', import.meta.url), 'utf8');
const turndownLicense = readFileSync(new URL('./node_modules/turndown/LICENSE', import.meta.url), 'utf8');
const turndownGfmLicense = readFileSync(new URL('./node_modules/turndown-plugin-gfm/LICENSE', import.meta.url), 'utf8');
// Identifier minification keeps the eight-language tables within the 5 MB release budget; esbuild scopes renames safely inside the bundle.
const options = { entryPoints: ['src/main.ts'], bundle: true, minify: true, loader: { '.woff2': 'dataurl' }, external: ['obsidian', '@codemirror/view', '@codemirror/state', 'electron', 'node:fs', 'node:path'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false, banner: { js: `/*! Qiaomu RSS — Copyright (c) 2026 向阳乔木; GPL-3.0-only.\nSource: https://github.com/joeseesun/qiaomu-ai-rss\n${projectLicense}\nTidings catalog: https://github.com/fuxiaoai/tidings-rss (CC0-1.0, metadata only)\nBlog catalog: https://github.com/timqian/chinese-independent-blogs\n${catalogLicense}\nBundled fonts: SIL OFL 1.1\n${fontLicense}\nTurndown: MIT\n${turndownLicense}\nTurndown GFM: MIT\n${turndownGfmLicense}*/` } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else {
  await build(options);
  for (const asset of ['main.js', 'styles.css']) {
    if (readFileSync(asset).byteLength > 5_000_000) throw new Error(`${asset} exceeds the 5 MB release budget`);
  }
}
