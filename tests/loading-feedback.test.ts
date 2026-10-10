// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', async original => ({
  ...await original<object>(), Component: class {}, ItemView: class {}, Modal: class {}, FuzzySuggestModal: class {}, TFile: class {}, Notice: vi.fn(class {}), Platform: { isDesktopApp: false, isMobileApp: false },
}));
import { ReaderView } from '../src/view';
import { initialState } from '../src/model';
import { t } from '../src/i18n';
function element(tag = 'div') {
  const el = document.createElement(tag);
  Object.assign(el, {
    setText: (text: string) => { el.textContent = text; },
    addClass: (name: string) => el.classList.add(name),
    removeClass: (name: string) => el.classList.remove(name),
    createDiv: (options: string | { cls?: string }) => { const child = element(); child.className = typeof options === 'string' ? options : options.cls || ''; el.append(child); return child; },
    createSpan: ({ text }: { text: string }) => { const child = element('span'); child.textContent = text; el.append(child); return child; },
    createEl: (tag: string, options: { text: string; cls: string }) => { const child = element(tag); child.className = options.cls; child.textContent = options.text; el.append(child); return child; },
  });
  return el;
}
const entry = { id: 'readable', sourceId: 'simonwillison', title: 'Readable', content: '<p>Cached original</p>' };
function fixture() {
  const state = initialState({ sources: [{ id: 'simonwillison', name: 'Simon' }], cache: { [entry.id]: { entry, rewrite: null, translation: null, fetchedAt: 1 } } });
  const api = { sources: vi.fn(async () => ({ sources: state.sources })), entries: vi.fn(async () => ({ entries: [entry], hasMore: false })), article: vi.fn() };
  const plugin = { state, api: () => api, persist: vi.fn(async () => {}), syncDeletedArticles: vi.fn(async () => {}), articleDeleted: () => false, isLater: () => false, remember: vi.fn() };
  const view = Object.assign(Object.create(ReaderView.prototype), {
    plugin, closed: false, source: 'simonwillison', listVersion: 0, articleVersion: 0, entries: [entry], loading: false,
    status: element(), reader: element(), contentEl: element(), refreshButton: element('button'),
    renderChannel: vi.fn(), renderFilters: vi.fn(), renderList: vi.fn(), renderReader: vi.fn(), expandWindowTo: vi.fn(), stopRestoring: vi.fn(),
  });
  return { view, api, plugin };
}
afterEach(() => vi.restoreAllMocks());
describe('loading feedback and cached reading', () => {
  it('labels a failed local catalog save correctly and retries only the local update', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { view, api, plugin } = fixture();
    plugin.persist.mockRejectedValueOnce(new Error('local write denied'));
    await view.loadEntries(false, true);
    await vi.waitFor(() => expect(view.status.textContent).toContain(t('reader.catalogSaveFailed')));
    expect(view.status.textContent).not.toContain(t('reader.channelsFailed'));
    expect(view.entries).toHaveLength(1);
    view.status.querySelector('button').click();
    await vi.waitFor(() => expect(view.status.textContent).toBe(''));
    expect(api.sources).toHaveBeenCalledOnce();
  });
  it('keeps channels and entries after a catalog failure; its retry only reloads the catalog', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { view, api, plugin } = fixture();
    api.sources.mockRejectedValueOnce(new Error('offline'));
    await view.loadEntries(false, true);
    expect(view.status.textContent).toContain(t('reader.catalogCached'));
    expect(plugin.state.sources).toHaveLength(1);
    expect(view.entries).toHaveLength(1);
    view.status.querySelector('button').click();
    await vi.waitFor(() => expect(view.status.textContent).toBe(''));
    expect(api.sources).toHaveBeenCalledTimes(2);
    expect(api.entries).toHaveBeenCalledOnce();
  });
  it('does not update the next channel with an older catalog response', async () => {
    const { view, api, plugin } = fixture();
    let resolve!: (value: { sources: [] }) => void;
    api.sources.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await view.loadEntries();
    view.listVersion++;
    resolve({ sources: [] });
    await Promise.resolve(); await Promise.resolve();
    expect(plugin.state.sources).toHaveLength(1);
    expect(view.renderChannel).not.toHaveBeenCalled();
  });
  it('shows a cached original immediately while waiting for the preferred rewrite', async () => {
    const { view, api } = fixture();
    let resolve!: (value: unknown) => void;
    api.article.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const open = view.openArticle(entry);
    expect(view.mode).toBe('original');
    expect(view.requestedMode).toBe('rewrite');
    expect(view.articleLoading).toBe(false);
    resolve({ bundle: { entry, rewrite: { body: 'New rewrite' }, translation: null, fetchedAt: 2 }, warnings: [] });
    await open;
    expect(view.mode).toBe('rewrite');
  });
  it('offers an inline retry that retains the manually selected version', async () => {
    const { view, api } = fixture();
    api.article.mockRejectedValueOnce(new Error('offline'));
    await view.openArticle(entry, undefined, 'original');
    expect(view.articleFailed).toBe(true);
    const parent = element();
    view.readerFeedback(parent, view.bundle);
    api.article.mockResolvedValueOnce({ bundle: { entry, rewrite: { body: 'Rewrite' }, translation: null, fetchedAt: 2 }, warnings: [] });
    parent.querySelector('button')!.click();
    await vi.waitFor(() => expect(view.articleFailed).toBe(false));
    expect(view.requestedMode).toBe('original');
    expect(view.mode).toBe('original');
    expect(api.article).toHaveBeenCalledTimes(2);
  });
});
