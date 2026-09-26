// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async original => ({
  ...await original<object>(),
  Component: class {},
  ItemView: class {},
  Modal: class {},
  FuzzySuggestModal: class {},
  TFile: class {},
  Notice: vi.fn(class { hide = vi.fn(); }),
  Platform: { isDesktopApp: false, isMobileApp: false },
}));

import { Notice } from 'obsidian';
import { ReaderView } from '../src/view';
import { articleNoteKey, initialState, type Bundle, type Mode } from '../src/model';
import { t } from '../src/i18n';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('note save settings retry', () => {
  it('resolves after creating the note when persist fails, then retries only settings', async () => {
    // Supply only the host fragment helpers used by the actual success notice.
    vi.stubGlobal('createFragment', (build: (fragment: DocumentFragment) => void) => {
      const fragment = document.createDocumentFragment();
      Object.assign(fragment, {
        appendText: (text: string) => fragment.append(document.createTextNode(text)),
        createEl: (tag: string, options: { text: string; href: string }) => {
          const element = document.createElement(tag);
          element.textContent = options.text;
          element.setAttribute('href', options.href);
          fragment.append(element);
          return element;
        },
      });
      build(fragment);
      return fragment;
    });

    const bundle: Bundle = {
      entry: { id: 'retry-article', sourceId: '@vault:/', title: 'Retry article', origin: 'vault', markdown: 'Saved content' },
      rewrite: null, translation: null, fetchedAt: 1,
    };
    const files = new Map<string, { path: string; content: string }>();
    const create = vi.fn(async (path: string, content: string) => {
      if (files.has(path)) throw new Error('File already exists');
      const file = { path, content };
      files.set(path, file);
      return file;
    });
    const state = initialState({});
    const persist = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('data.json permission denied'))
      .mockResolvedValueOnce(undefined);
    const renderReader = vi.fn();
    const openFile = vi.fn();
    // Use the production prototype (including run), without mounting an Obsidian view.
    const view = Object.assign(Object.create(ReaderView.prototype), {
      app: {
        vault: { getAbstractFileByPath: (path: string) => files.get(path), create },
        workspace: { getLeaf: vi.fn(() => ({ openFile })) },
      },
      plugin: { state, persist, images: {} },
      contentEl: document.createElement('div'),
      bundle, closed: false, renderReader,
    }) as { saveNoteAt: (bundle: Bundle, mode: Mode, folder: string, remember: boolean) => Promise<void> };

    // Resolving lets NoteLocationModal close instead of offering another file save.
    await expect(view.saveNoteAt(bundle, 'original', '', true)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    const [path] = files.keys();
    expect(files.get(path)?.content).toBe('Saved content\n');
    expect(state.articleNotes[articleNoteKey(bundle.entry.id, 'original')]).toBe(path);
    expect(state.settings.articleFolder).toBe('');
    expect(renderReader).toHaveBeenCalledWith(true);

    const success = vi.mocked(Notice).mock.calls.map(([message]) => message)
      .find((message): message is DocumentFragment => message instanceof DocumentFragment);
    expect(success?.textContent).toContain(t('notice.savedNote'));
    expect(success?.textContent).toContain(t('note.settingsSaveFailed'));
    const retry = [...success!.querySelectorAll('a')].find(link => link.textContent === t('common.retry'));
    expect(retry).toBeDefined();
    const click = new MouseEvent('click', { cancelable: true });
    retry!.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
    await expect(persist.mock.results[1].value).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
    expect([...files.keys()]).toEqual([path]);
    expect(state.articleNotes[articleNoteKey(bundle.entry.id, 'original')]).toBe(path);
    expect(state.settings.articleFolder).toBe('');
    expect(openFile).not.toHaveBeenCalled();
  });
});
