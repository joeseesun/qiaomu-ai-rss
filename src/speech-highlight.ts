import { z } from 'zod';
export const DEFAULT_HIGHLIGHT = { style: 'background' as const, color: '#e0a400' };
export const speechHighlightSchema = z.object({
  style: z.enum(['background', 'underline', 'sentence']).catch('background').default('background'),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).catch(DEFAULT_HIGHLIGHT.color).default(DEFAULT_HIGHLIGHT.color),
}).catch(DEFAULT_HIGHLIGHT).default(DEFAULT_HIGHLIGHT);
export type SpeechHighlight = z.infer<typeof speechHighlightSchema>;
type RGB = [number, number, number];
function rgb(value: string, fallback: RGB): RGB {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) { const text = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]; return [0, 2, 4].map(i => parseInt(text.slice(i, i + 2), 16)) as RGB; }
  const parts = value.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : fallback;
}
function luminance(value: RGB) { return value.map(c => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0); }
export function contrastRatio(ink: string, paper: string) { return contrast(rgb(ink, [0, 0, 0]), rgb(paper, [255, 255, 255])); }
function contrast(a: RGB, b: RGB) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
const mix = (a: RGB, b: RGB, alpha: number): RGB => a.map((c, i) => Math.round(c * (1 - alpha) + b[i] * alpha)) as RGB;
const css = (value: RGB) => `rgb(${value.join(', ')})`;
export function highlightPalette(color: string, surface: string, foreground: string) {
  const paper = rgb(surface, [255, 255, 255]), tint = rgb(color, [224, 164, 0]);
  let ink = rgb(foreground, [41, 41, 41]);
  if (contrast(ink, paper) < 4.5) ink = contrast([0, 0, 0], paper) >= contrast([255, 255, 255], paper) ? [0, 0, 0] : [255, 255, 255];
  const wash = (alpha: number) => { let result = mix(paper, tint, alpha); while (alpha > 0 && contrast(ink, result) < 4.5) { alpha = Math.max(0, alpha - 0.01); result = mix(paper, tint, alpha); } return css(result); };
  let line = tint, alpha = 0;
  while (contrast(line, paper) < 3 && alpha < 1) { alpha = Math.min(1, alpha + 0.05); line = mix(tint, ink, alpha); }
  return { sentence: wash(0.09), word: wash(0.28), ink: css(ink), line: css(line) };
}
export function applyHighlightAppearance(prose: HTMLElement, settings: SpeechHighlight) {
  const win = prose.ownerDocument.defaultView;
  if (!win) return;
  const computed = win.getComputedStyle(prose);
  let node: HTMLElement | null = prose, surface = '';
  while (node) { const bg = win.getComputedStyle(node).backgroundColor; if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') { surface = bg; break; } node = node.parentElement; }
  const palette = highlightPalette(settings.color, surface, computed.color);
  prose.dataset.qrsSpeechStyle = settings.style;
  for (const [key, value] of Object.entries(palette)) prose.style.setProperty(`--qrs-speech-${key}`, value);
}
