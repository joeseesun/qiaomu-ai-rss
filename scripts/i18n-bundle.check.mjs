import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { compressI18n } from './compress-i18n.mjs';
test('production compression preserves every message and locale without code evaluation', () => {
  const source = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
  const expected = JSON.parse('[' + source.match(/export const M = \[([\s\S]*?)\] as const;/)[1].trim().replace(/,$/, '') + ']');
  const bundled = compressI18n(source).contents;
  const encoded = JSON.parse(bundled.match(/decompressFromBase64\(("[^\n]+?")\)/)[1]);
  assert.deepEqual(JSON.parse(LZString.decompressFromBase64(encoded)), expected);
  assert.ok(Buffer.byteLength(bundled) < Buffer.byteLength(source) - 80000);
});
