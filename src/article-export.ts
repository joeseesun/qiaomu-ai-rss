import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { articleFragment } from './content';
import { modeLabels, safeUrl, titleOf, type Bundle, type Mode } from './model';

function escapeMarkdown(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()#+.!|>])/g, '\\$1').trim();
}

/** A file-system-safe base name shared by every export format: "<title> - <mode>". */
export function exportBaseName(bundle: Bundle, mode: Mode): string {
  const title = [...titleOf(bundle.entry).replace(/[\\/:*?"<>|#^[\]]/g, ' ')].filter(char => char.charCodeAt(0) >= 32).join('').replace(/\s+/g, ' ').trim().slice(0, 90) || '文章';
  return `${title} - ${modeLabels[mode]}`;
}

export function articleExportBody(bundle: Bundle, mode: Mode, doc: Document, images: boolean): HTMLElement | null {
  const fragment = articleFragment(bundle, mode, doc, images);
  if (!fragment) return null;
  const container = doc.createElement('div');
  container.append(fragment);
  return container;
}

export function articleExportMarkdown(bundle: Bundle, mode: Mode, body: HTMLElement | null): string | null {
  if (bundle.entry.origin === 'vault' && bundle.entry.markdown != null) {
    return bundle.entry.markdown.trim() ? `${bundle.entry.markdown.trimEnd()}\n` : null;
  }
  if (!body || (!body.textContent?.trim() && !body.querySelector('img'))) return null;
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  converter.use(gfm);
  // CommonMark can treat **bold punctuation**紧接中文 as literal asterisks.
  converter.addRule('qrs-strong', {
    filter: ['strong', 'b'],
    replacement(content, node) {
      const next = node.nextSibling?.textContent?.charAt(0) || '';
      return `**${content}**${next && /[\p{L}\p{N}]/u.test(next) ? ' ' : ''}`;
    },
  });
  const content = converter.turndown(body.innerHTML).trim();
  if (!content) return null;
  const entry = bundle.entry;
  const title = escapeMarkdown(titleOf(entry)).replace(/\\([#+.!|>()])/g, '$1');
  const facts = [entry.sourceName?.trim(), entry.author?.trim(), entry.published?.trim().slice(0, 10), modeLabels[mode]].filter(Boolean);
  const header = [`# ${title}`, facts.length ? `> ${facts.map(value => escapeMarkdown(value!)).join(' · ')}` : ''];
  const source = entry.link ? safeUrl(entry.link) : null;
  if (source) header.push(`> [原文链接](<${source}>)`);
  return `${header.filter(Boolean).join('\n\n')}\n\n${content}\n`;
}
