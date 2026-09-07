import { moment, normalizePath, type Vault } from 'obsidian';
import { safeUrl, titleOf, type Entry, type Mode } from './model';

export interface DailyNoteSettings { folder: string; format: string; template: string }
export interface DateFormatter { format(pattern: string): string }
const currentMoment = () => (moment as unknown as () => DateFormatter)();

function cleanPath(value: string): string {
  const path = normalizePath(value.trim().replace(/^\/+|\/+$/g, ''));
  return path === '/' || path.startsWith('.') || path.split('/').includes('..') ? '' : path;
}

export async function readDailyNoteSettings(vault: Vault): Promise<DailyNoteSettings> {
  const defaults = { folder: '', format: 'YYYY-MM-DD', template: '' };
  const path = `${vault.configDir}/daily-notes.json`;
  try {
    if (!(await vault.adapter.exists(path))) return defaults;
    const parsed = JSON.parse(await vault.adapter.read(path)) as Record<string, unknown>;
    return {
      folder: typeof parsed.folder === 'string' ? cleanPath(parsed.folder) : '',
      format: typeof parsed.format === 'string' && parsed.format.trim() ? parsed.format.trim() : defaults.format,
      template: typeof parsed.template === 'string' ? cleanPath(parsed.template.replace(/\.md$/i, '')) : '',
    };
  } catch { return defaults; }
}

export function dailyNotePath(settings: DailyNoteSettings, now: DateFormatter = currentMoment()): string {
  const dated = cleanPath(now.format(settings.format)) || now.format('YYYY-MM-DD');
  return normalizePath(`${settings.folder ? `${settings.folder}/` : ''}${dated}.md`);
}

export interface CaptureOptions { vault?: string; article?: string; mode?: Mode; excerpt?: string }
export function articleNoteUrl(options: CaptureOptions): string {
  const params = new URLSearchParams({ vault: options.vault || '', article: options.article || '', mode: options.mode || 'original' });
  return `obsidian://qiaomu-ai-rss?${params.toString().replace(/\+/g, '%20')}`;
}
export function markdownText(text: string): string { return text.replace(/([\\`*_{}[\]()<>#+.!|~-])/g, '\\$1'); }
export function dailyNoteLink(entry: Entry, options: CaptureOptions = {}): string {
  const link = options.article ? articleNoteUrl(options) : entry.link ? safeUrl(entry.link) : null;
  if (!link) throw new Error('这篇文章没有可用的链接。');
  const title = markdownText(titleOf(entry).replace(/\s+/g, ' ').trim() || '未命名文章');
  const original = (entry.link ? safeUrl(entry.link) : null) || (entry.origin === 'vault' && entry.markdownPath && options.vault ? `obsidian://open?vault=${encodeURIComponent(options.vault)}&file=${encodeURIComponent(entry.markdownPath)}` : null);
  return `[${title}](<${link}>)` + (options.article && original ? ` · [原文](<${original}>)` : '');
}
export function repairArticleLinks(content: string): string {
  return content.replace(/obsidian:\/\/qiaomu-ai-rss\?[^\s<>)]*/g, url => url.replace(/\+/g, '%20'));
}
export function cleanCaptureMarkers(content: string): string {
  return content.replace(/^[ \t]*<!-- qrs-article:[^\r\n]*?-->[ \t]*(?:\r?\n)?/gm, '');
}
export function appendDailyNoteLink(content: string, entry: Entry, options: CaptureOptions = {}): { content: string; added: boolean } {
  content = cleanCaptureMarkers(repairArticleLinks(content));
  const title = dailyNoteLink(entry, options);
  const excerpt = options.excerpt?.trim();
  const text = excerpt ? markdownText(excerpt) : '';
  // Upgrade an existing capture's header without changing its title or reading-version link.
  const originalSuffix = title.slice(title.indexOf('>)') + 2);
  if (options.article && originalSuffix) {
    content = content.replace(/^(\[[^\n]*?\]\(<(obsidian:\/\/qiaomu-ai-rss\?[^\n>]+)>\))(?! · \[原文\])/gm, (whole: string, header: string, url: string) => {
      try { return new URL(url).searchParams.get('article') === options.article ? header + originalSuffix : whole; } catch { return whole; }
    });
  }
  // Recognize 0.9.0 captures, including its form-encoded spaces and other reading modes.
  const links = [...content.matchAll(/^\[[^\n]*?\]\(<([^\n>]+)>\)(?: · \[原文\]\(<[^\n>]+>\))?$/gm)];
  const existing = links.find(match => {
    if (!options.article) return match[0] === title;
    try { return new URL(match[1]).searchParams.get('article') === options.article; } catch { return false; }
  });
  if (existing?.index !== undefined) {
    const next = links.find(match => match.index > existing.index)?.index ?? content.length;
    const section = content.slice(existing.index + existing[0].length, next).trim();
    const added = !!text && !('\n\n' + section.trim() + '\n\n').includes('\n\n' + text + '\n\n');
    if (!added) return { content, added };
    const updated = title + '\n\n' + section + (added ? '\n\n' + text : '') + '\n\n';
    return { content: content.slice(0, existing.index) + updated + content.slice(next), added };
  }
  const block = text ? `${title}\n\n${text}` : title;
  const separator = !content || content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${content}${separator}${block}\n\n`, added: true };
}

export function renderDailyNoteTemplate(template: string, title: string, now: DateFormatter = currentMoment()): string {
  return template
    .replace(/{{\s*date(?::([^}]+))?\s*}}/gi, (_, format: string | undefined) => now.format(format?.trim() || 'YYYY-MM-DD'))
    .replace(/{{\s*time(?::([^}]+))?\s*}}/gi, (_, format: string | undefined) => now.format(format?.trim() || 'HH:mm'))
    .replace(/{{\s*title\s*}}/gi, title);
}
