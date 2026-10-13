import { splitSpeechText } from '@qiaomu/speech/speech/text';
import { speechFingerprint } from '@qiaomu/speech/speech/progress';
import type { SpeechItem } from '@qiaomu/speech/speech';
export interface ArticleSpeechItem extends SpeechItem { block: HTMLElement }
// Read rendered prose, preserving paragraph ownership; metadata, media and code never become speech.
export function articleSpeechSource(prose: HTMLElement, limit: number, clauses: boolean) {
  const excluded = 'script,style,nav,pre,code,rt,rp,svg,math,[hidden],[aria-hidden="true"],.qrs-media,.qrs-feedback,.qrs-empty';
  const walker = prose.ownerDocument.createTreeWalker(prose, 4);
  const groups: Array<{ block: HTMLElement; text: string }> = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent || node.parentElement?.closest(excluded)) continue;
    const block = node.parentElement?.closest<HTMLElement>('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div') || prose;
    let group = groups.at(-1);
    if (group?.block !== block) { group = { block, text: '' }; groups.push(group); }
    group.text += node.textContent;
  }
  let offset = 0;
  const items: ArticleSpeechItem[] = [], bodies: string[] = [];
  for (const group of groups) {
    const text = group.text.replace(/\s+/g, ' ').trim(); if (!text) continue;
    bodies.push(text);
    for (const part of splitSpeechText(text, limit, clauses)) items.push({ ...part, start: part.start + offset, end: part.end + offset, block: group.block });
    offset += text.length + 1;
  }
  return { items, fingerprint: speechFingerprint(bodies.join('\n')) };
}
