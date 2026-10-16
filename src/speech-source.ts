import { splitSpeechText } from '@qiaomu/speech/speech/text';
import { speechFingerprint } from '@qiaomu/speech/speech/progress';
import type { SpeechItem } from '@qiaomu/speech/speech';
export interface ArticleSpeechItem extends SpeechItem {
  block: HTMLElement;
  /** DOM range for characters [from, to) of `text`; absent for items not tied to rendered prose. */
  range?: (from: number, to: number) => Range | null;
}
// Read rendered prose, preserving paragraph ownership; metadata, media and code never become speech.
export function articleSpeechSource(prose: HTMLElement, limit: number, clauses: boolean, scope?: Range) {
  if (scope && (scope.collapsed || !prose.contains(scope.startContainer) || !prose.contains(scope.endContainer))) return { items: [], fingerprint: speechFingerprint('') };
  const excluded = 'script,style,nav,pre,code,rt,rp,svg,math,[hidden],[aria-hidden="true"],.qrs-media,.qrs-feedback,.qrs-empty';
  const walker = prose.ownerDocument.createTreeWalker(prose, 4);
  const groups: Array<{ block: HTMLElement; text: string; nodes: Array<{ node: Text; start: number; offset: number; length: number }> }> = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent || node.parentElement?.closest(excluded)) continue;
    if (scope && !scope.intersectsNode(node)) continue;
    const from = scope?.startContainer === node ? scope.startOffset : 0;
    const to = scope?.endContainer === node ? scope.endOffset : node.textContent.length;
    if (to <= from) continue;
    const block = node.parentElement?.closest<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div') || prose;
    let group = groups.at(-1);
    if (group?.block !== block) { group = { block, text: '', nodes: [] }; groups.push(group); }
    group.nodes.push({ node: node as Text, start: group.text.length, offset: from, length: to - from });
    group.text += node.textContent.slice(from, to);
  }
  let offset = 0;
  const items: ArticleSpeechItem[] = [], bodies: string[] = [];
  for (const group of groups) {
    const { text, source } = collapse(group.text); if (!text) continue;
    bodies.push(text);
    for (const part of splitSpeechText(text, limit, clauses)) {
      const lead = text.slice(part.start).search(/\S/), at = part.start + Math.max(0, lead);
      items.push({ ...part, start: part.start + offset, end: part.end + offset, block: group.block, range: (from, to) => domRange(group, source, at + from, at + to) });
    }
    offset += text.length + 1;
  }
  return { items, fingerprint: speechFingerprint(bodies.join('\n')) };
}
// Collapse whitespace like speech does, remembering where each kept character came from.
function collapse(raw: string) {
  let text = '', source: number[] = [], space = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) { space = true; continue; }
    if (space && text) { text += ' '; source.push(i - 1); }
    space = false; text += raw[i]; source.push(i);
  }
  return { text, source };
}
function domRange(group: { block: HTMLElement; nodes: Array<{ node: Text; start: number; offset: number; length: number }> }, source: number[], from: number, to: number) {
  if (to <= from || from < 0 || from >= source.length) return null;
  const last = source[Math.min(to, source.length) - 1];
  const point = (offset: number, end: boolean): [Text, number] | null => {
    const entry = group.nodes.find(x => offset < x.start + x.length) ?? group.nodes.at(-1);
    return entry ? [entry.node, entry.offset + Math.min(entry.length, offset - entry.start + (end ? 1 : 0))] : null;
  };
  const a = point(source[from], false), b = point(last, true);
  if (!a || !b) return null;
  const range = group.block.ownerDocument.createRange();
  range.setStart(...a); range.setEnd(...b);
  return range;
}

/** Capture before menu/button focus collapses the browser selection. Never locate by matching text. */
export function articleSelection(prose: HTMLElement | null | undefined): Range | undefined {
  const selection = prose?.ownerDocument.getSelection();
  if (!prose || !selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (prose.contains(range.startContainer) && prose.contains(range.endContainer) && range.toString().trim()) return range.cloneRange();
}

export function sameSpeechRange(a: Range | undefined, b: Range | undefined): boolean {
  return !!a && !!b && a.startContainer === b.startContainer && a.endContainer === b.endContainer && a.startOffset === b.startOffset && a.endOffset === b.endOffset;
}
