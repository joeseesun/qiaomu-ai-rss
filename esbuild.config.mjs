import { build, context } from 'esbuild';
const options = { entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
