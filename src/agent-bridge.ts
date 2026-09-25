import { Notice, type App } from 'obsidian';
import { CONTEXT_PROTOCOL, CONTEXT_VERSION, MAX_CONTEXT_TEXT, MAX_SELECTION_TEXT, clipText, findAgent, type ContextProvider, type ContextSnapshot } from './qiaomu-context';
import { modeLabel, safeUrl, titleOf, type Bundle, type Mode } from './model';
import { t } from './i18n';

export interface ReadingState { bundle: Bundle; mode: Mode; prose: HTMLElement | null }

/** What the reader shows right now, in the version the user chose, for Qiaomu Agent. */
export function articleSnapshot(sourceId: string, state: ReadingState): ContextSnapshot {
  const entry = state.bundle.entry;
  const body = clipText(state.prose?.innerText || state.prose?.textContent || '', MAX_CONTEXT_TEXT);
  return {
    sourceId, sourceName: t('agent.sourceName'), kind: 'article',
    title: titleOf(entry),
    url: safeUrl(entry.link || '') || undefined,
    path: entry.origin === 'vault' ? entry.markdownPath || undefined : undefined,
    author: entry.author || undefined,
    published: entry.published || undefined,
    location: modeLabel(state.mode),
    text: body.text || undefined,
    truncated: body.truncated || undefined,
  };
}

/** The provider Qiaomu Agent discovers at `plugin.qiaomuContext`. */
export function contextProvider(snapshot: (leaf: Parameters<ContextProvider['snapshot']>[0]) => ContextSnapshot | null): ContextProvider {
  return { protocol: CONTEXT_PROTOCOL, version: CONTEXT_VERSION, snapshot };
}

/** True only while a compatible Qiaomu Agent is installed and enabled. */
export function agentAvailable(app: App): boolean {
  return findAgent(app) !== null;
}

/** Opens Qiaomu Agent with the article (and selected passage) attached; the user writes the question. */
export async function askAgent(app: App, snapshot: ContextSnapshot, selection?: string): Promise<void> {
  const agent = findAgent(app);
  if (!agent) return;
  const text = selection?.trim();
  try {
    await agent.ask({ context: text ? { ...snapshot, selection: { text: clipText(text, MAX_SELECTION_TEXT).text } } : snapshot });
  } catch {
    new Notice(t('notice.agentFailed'));
  }
}
