// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', async original => ({ ...await original<object>(), Notice: vi.fn() }));
import { Notice } from 'obsidian';
import { agentAvailable, articleSnapshot, askAgent, contextProvider } from '../src/agent-bridge';
import type { Bundle } from '../src/model';

const bundle: Bundle = {
  entry: { id: 'a1', sourceId: 'blog', title: 'Original title', titleZh: '中文标题', link: 'https://example.com/post', author: 'Ada', published: '2026-09-20' },
  rewrite: null, translation: null, fetchedAt: 1,
};

function prose(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  return el;
}

const agent = (ask = vi.fn(async () => undefined)) => ({ ask, app: { plugins: { plugins: { 'qiaomu-agent': { api: { protocol: 'qiaomu-agent', version: 1, ask } } } } } as never });

describe('Qiaomu Agent bridge', () => {
  it('describes the shown version of the article', () => {
    const snapshot = articleSnapshot('qiaomu-ai-rss', { bundle, mode: 'translation', prose: prose('第一段。') });
    expect(snapshot).toMatchObject({ sourceId: 'qiaomu-ai-rss', kind: 'article', title: '中文标题', url: 'https://example.com/post', author: 'Ada', text: '第一段。' });
    expect(snapshot.location).toBeTruthy();
    expect(snapshot.truncated).toBeUndefined();
  });

  it('omits unsafe links, vault paths of remote entries and empty bodies', () => {
    const remote = structuredClone(bundle);
    remote.entry.link = 'javascript:alert(1)'; remote.entry.markdownPath = 'Clippings/a.md';
    const snapshot = articleSnapshot('rss', { bundle: remote, mode: 'original', prose: null });
    expect(snapshot.url).toBeUndefined();
    expect(snapshot.path).toBeUndefined();
    expect(snapshot.text).toBeUndefined();
    const vault = structuredClone(bundle);
    vault.entry.origin = 'vault';
    vault.entry.markdownPath = 'Clippings/a.md';
    expect(articleSnapshot('rss', { bundle: vault, mode: 'original', prose: null }).path).toBe('Clippings/a.md');
  });

  it('condenses very long articles', () => {
    const snapshot = articleSnapshot('rss', { bundle, mode: 'original', prose: prose('字'.repeat(80_000)) });
    expect(snapshot.text!.length).toBeLessThanOrEqual(60_000);
    expect(snapshot.truncated).toBe(true);
  });

  it('is only available with a compatible agent', () => {
    expect(agentAvailable({ plugins: { plugins: {} } } as never)).toBe(false);
    expect(agentAvailable({} as never)).toBe(false);
    expect(agentAvailable({ plugins: { plugins: { 'qiaomu-agent': { api: { protocol: 'qiaomu-agent', version: 2, ask: vi.fn() } } } } } as never)).toBe(false);
    expect(agentAvailable(agent().app)).toBe(true);
  });

  it('hands the selected passage to the agent', async () => {
    const { ask, app } = agent();
    const snapshot = articleSnapshot('rss', { bundle, mode: 'original', prose: prose('正文') });
    await askAgent(app, snapshot, '  选中的一句话 ');
    expect(ask).toHaveBeenCalledWith({ context: { ...snapshot, selection: { text: '选中的一句话' } } });
    await askAgent(app, snapshot);
    expect(ask).toHaveBeenLastCalledWith({ context: snapshot });
  });

  it('reports a failing agent instead of throwing', async () => {
    const { app } = agent(vi.fn(async () => { throw new Error('boom'); }));
    await expect(askAgent(app, articleSnapshot('rss', { bundle, mode: 'original', prose: null }), 'x')).resolves.toBeUndefined();
    expect(Notice).toHaveBeenCalled();
  });

  it('exposes a versioned provider', () => {
    const provider = contextProvider(() => null);
    expect(provider).toMatchObject({ protocol: 'qiaomu-context', version: 1 });
  });
});
