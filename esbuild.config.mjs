import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
const projectLicense = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8');
const catalogLicense = readFileSync(new URL('./vendor/chinese-independent-blogs/LICENSE', import.meta.url), 'utf8');
const fontLicense = readFileSync(new URL('./fonts/OFL.txt', import.meta.url), 'utf8');
const options = { entryPoints: ['src/main.ts'], bundle: true, loader: { '.gz': 'dataurl' }, external: ['obsidian', '@codemirror/view', '@codemirror/state'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false, banner: { js: `/*! Qiaomu RSS — Copyright (c) 2026 向阳乔木; GPL-3.0-only.\nSource: https://github.com/joeseesun/qiaomu-ai-rss\n${projectLicense}\nBlog catalog: https://github.com/timqian/chinese-independent-blogs\n${catalogLicense}\nBundled fonts: SIL OFL 1.1\n${fontLicense}*/` } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
