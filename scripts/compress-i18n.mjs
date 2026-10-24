import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
// Compress only static translation data. Source remains a readable, type-checked eight-language table.
export function compressI18n(source) {
  const pattern = /export const M = \[([\s\S]*?)\] as const;/;
  const match = source.match(pattern); if (!match) throw new Error('Translation table not found');
  const json = JSON.stringify(JSON.parse('[' + match[1].trim().replace(/,$/, '') + ']'));
  const compressed = LZString.compressToBase64(json);
  if (LZString.decompressFromBase64(compressed) !== json) throw new Error('Translation compression mismatch');
  return { contents: "import LZString from 'lz-string';\n" + source.replace(pattern, `export const M = JSON.parse(LZString.decompressFromBase64(${JSON.stringify(compressed)}));`), loader: 'ts' };
}
export const compressedI18n = { name: 'static-translation-data', setup(build) { build.onLoad({ filter: /[\\/]src[\\/]i18n\.ts$/ }, ({ path }) => compressI18n(readFileSync(path, 'utf8'))); build.onLoad({ filter: /[\\/](independent-blogs|tidings)\.json$/ }, ({ path }) => compressCatalog(readFileSync(path, 'utf8'))); } };

export function compressCatalog(source) {
  const json = JSON.stringify(JSON.parse(source));
  const packed = LZString.compressToBase64(json);
  if (LZString.decompressFromBase64(packed) !== json) throw new Error("Catalog compression mismatch");
  return { contents: "import LZString from 'lz-string'; export default JSON.parse(LZString.decompressFromBase64(" + JSON.stringify(packed) + "));", loader: "js" };
}
