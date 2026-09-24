import { modeLabels, titleOf, type Bundle, type Mode } from './model';

export interface MarkdownExportTemplates {
  exportFolder: string;
  exportFilename: string;
  exportAssetFolder: string;
}

export function safeFilenamePart(value: string): string {
  return value.replace(/[\\/:*?"<>|#\r\n\t]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

const pad = (value: number) => String(value).padStart(2, '0');
const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function renderExportTemplate(template: string, bundle: Bundle, mode: Mode, now = new Date(), extra: Record<string, string> = {}): string {
  const entry = bundle.entry;
  const published = entry.publishedTs ? new Date(entry.publishedTs) : entry.published ? new Date(entry.published) : null;
  const date = published && !Number.isNaN(published.getTime()) ? published : now;
  const values: Record<string, string> = {
    title: safeFilenamePart(titleOf(entry)) || '文章',
    source: safeFilenamePart(entry.sourceName || entry.sourceId || 'RSS') || 'RSS',
    mode: safeFilenamePart(modeLabels[mode]) || mode,
    id: safeFilenamePart(entry.id).slice(0, 24) || 'article',
    date: day(date),
    datetime: `${day(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    ...extra,
  };
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_whole, key: string) => safeFilenamePart(values[key] ?? '')).replace(/[^\S\r\n]+/g, ' ').trim();
}

export function relativeAssetPath(markdownPath: string, assetPath: string): string {
  const from = markdownPath.replace(/\\/g, '/').split('/').slice(0, -1), to = assetPath.replace(/\\/g, '/').split('/');
  while (from[0] && from[0] === to[0]) { from.shift(); to.shift(); }
  const out = [...from.map(() => '..'), ...to].join('/') || '.';
  return out.startsWith('.') ? out : `./${out}`;
}

export function markdownAssetPath(markdownPath: string, assetPath: string): string {
  return relativeAssetPath(markdownPath, assetPath);
}

function joinPath(...parts: string[]): string {
  const absolute = /^[A-Za-z]:[\\/]/.test(parts[0]);
  const joined = parts.filter(Boolean).join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
  return absolute ? joined.replace(/^([A-Za-z]:)\//, '$1/') : joined.replace(/^\/+/, '');
}

export function vaultExportPath(vaultBase: string, bundle: Bundle, mode: Mode, settings: MarkdownExportTemplates, now = new Date()) {
  const renderedName = renderExportTemplate(settings.exportFilename || '{title} - {mode}.md', bundle, mode, now);
  const filename = renderedName.toLowerCase().endsWith('.md') ? renderedName : `${renderedName}.md`;
  const basename = filename.replace(/\.md$/i, '');
  const folder = renderExportTemplate(settings.exportFolder || '', bundle, mode, now);
  const assetFolder = renderExportTemplate(settings.exportAssetFolder || '{filename}.assets', bundle, mode, now, { filename: basename });
  return {
    markdownFile: joinPath(vaultBase, folder, filename),
    assetFolder: joinPath(vaultBase, assetFolder),
  };
}
