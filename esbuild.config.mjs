import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
const catalogLicense = readFileSync(new URL('./vendor/chinese-independent-blogs/LICENSE', import.meta.url), 'utf8');
const options = { entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false, banner: { js: `/*! Blog catalog: https://github.com/timqian/chinese-independent-blogs\n${catalogLicense}*/` } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
