// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { RssApi } from '../src/api';
import { AudioDock, audioUrl, pauseVideos, renderMedia, stopMedia, youtubeEmbedUrl } from '../src/media';
import { initialState, type Entry } from '../src/model';

const entry: Entry = { id: 'episode', sourceId: 'podcast', title: 'Episode' };
describe('media data and source safety', () => {
  it('retains remote audio through API parsing and persisted state', async () => {
    const audio = { url: 'https://media.example/episode.m4a', type: 'audio/mp4' };
    const transport = vi.fn(async () => ({ status: 200, text: JSON.stringify({ entries: [{ ...entry, audio }], hasMore: false }) }));
    const result = await new RssApi('https://rss.qiaomu.ai', transport).entries('podcast');
    expect(result.entries[0].audio).toEqual(audio);
    expect(transport.mock.calls[0][0]).not.toContain('ready=rewrite');
    const state = initialState({ entries: result.entries });
    expect(initialState(JSON.parse(JSON.stringify(state))).entries[0].audio).toEqual(audio);
  });
  it('accepts only HTTPS audio with audio MIME and no credentials', () => {
    expect(audioUrl({ ...entry, audio: { url: 'https://media.example/a.mp3', type: 'audio/mpeg' } })).toBe('https://media.example/a.mp3');
    for (const url of ['javascript:alert(1)', 'http://media.example/a.mp3', 'https://user:pass@media.example/a.mp3']) {
      expect(audioUrl({ ...entry, audio: { url, type: 'audio/mpeg' } })).toBeNull();
    }
    expect(audioUrl({ ...entry, audio: { url: 'https://example.com/payload', type: 'text/html' } })).toBeNull();
  });
  it('accepts canonical YouTube IDs but not lookalike hosts or arbitrary paths', () => {
    expect(youtubeEmbedUrl('https://www.youtube.com/watch?v=JtomF4bGxHs&t=90')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    expect(youtubeEmbedUrl('https://youtu.be/JtomF4bGxHs')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    expect(youtubeEmbedUrl('https://m.youtube.com/shorts/JtomF4bGxHs')).toBe('https://www.youtube.com/embed/JtomF4bGxHs');
    for (const url of ['https://youtube.com.evil.test/watch?v=JtomF4bGxHs', 'https://www.youtube.com/@account', 'http://www.youtube.com/watch?v=JtomF4bGxHs', 'https://www.youtube.com/watch?v=bad']) expect(youtubeEmbedUrl(url)).toBeNull();
  });
  it('shows the YouTube player preview immediately without autoplay or extra copy', () => {
    const article = document.createElement('article');
    const createEl = function (this: HTMLElement, tag: keyof HTMLElementTagNameMap, options?: { cls?: string; attr?: Record<string, string> }) {
      const child = document.createElement(tag);
      if (options?.cls) child.className = options.cls;
      for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
      Object.assign(child, { createEl });
      this.append(child);
      return child;
    };
    Object.assign(article, { createEl });

    renderMedia(article, { ...entry, link: 'https://www.youtube.com/watch?v=JtomF4bGxHs' });

    const frame = article.querySelector('iframe.qrs-video-frame');
    expect(frame?.getAttribute('src')).toBe('https://www.youtube.com/embed/JtomF4bGxHs?autoplay=0&playsinline=1&enablejsapi=1');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation allow-popups');
    expect(frame?.getAttribute('title')).toBe('视频播放器');
    expect(article.querySelector('button, p')).toBeNull();
  });
  it('stops removed audio and unloads an embedded frame on article switch', () => {
    const root = document.createElement('div');
    root.innerHTML = '<audio src="https://media.example/a.mp3"></audio><iframe class="qrs-video-frame" src="https://www.youtube.com/embed/JtomF4bGxHs"></iframe>';
    const audio = root.querySelector('audio')!;
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(audio, 'load').mockImplementation(() => undefined);
    stopMedia(root);
    expect(pause).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledOnce();
    expect(audio.hasAttribute('src')).toBe(false);
    expect(root.querySelector('iframe')?.hasAttribute('src')).toBe(false);
  });
  it('pauses embedded videos through the YouTube player API when the reader is hidden', () => {
    const root = document.createElement('div');
    root.innerHTML = '<iframe class="qrs-video-frame"></iframe>'; document.body.append(root);
    const post = vi.spyOn(root.querySelector('iframe')!.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    pauseVideos(root);
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
    root.remove();
  });
});

describe('podcast audio dock', () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.assign(proto, {
    createEl(this: HTMLElement, tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
      const child = document.createElement(tag);
      if (options?.cls) child.className = options.cls;
      if (options?.text) child.textContent = options.text;
      for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
      this.append(child); return child;
    },
    createDiv(this: HTMLElement, options?: { cls?: string }) { return (this as unknown as { createEl: (tag: string, o?: unknown) => HTMLElement }).createEl('div', options); },
    createSpan(this: HTMLElement, options?: { cls?: string; text?: string }) { return (this as unknown as { createEl: (tag: string, o?: unknown) => HTMLElement }).createEl('span', options); },
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    addClass(this: HTMLElement, cls: string) { this.classList.add(cls); },
    removeClass(this: HTMLElement, cls: string) { this.classList.remove(cls); },
  });
  const episode = (id: string): Entry => ({ ...entry, id, title: `Episode ${id}`, audio: { url: `https://media.example/${id}.mp3`, type: 'audio/mpeg' } });
  const setup = () => {
    const parent = document.createElement('div'); const onOpen = vi.fn();
    const dock = new AudioDock(parent, onOpen);
    const audio = parent.querySelector('audio')!;
    vi.spyOn(audio, 'pause').mockImplementation(() => undefined); vi.spyOn(audio, 'load').mockImplementation(() => undefined);
    return { parent, dock, audio, onOpen, bar: parent.querySelector('.qrs-audio-dock')! };
  };
  it('stays hidden until an episode with audio is opened', () => {
    const { dock, bar } = setup();
    expect(bar.classList.contains('is-hidden')).toBe(true);
    dock.open({ ...entry, link: 'https://example.com/post' });
    expect(bar.classList.contains('is-hidden')).toBe(true); expect(dock.entry).toBeNull();
    dock.open(episode('a'));
    expect(bar.classList.contains('is-hidden')).toBe(false);
    expect(bar.querySelector('audio')?.getAttribute('src')).toBe('https://media.example/a.mp3');
    expect(bar.querySelector('.qrs-audio-title')?.textContent).toBe('Episode a');
  });
  it('keeps the same episode loaded and stops it when another article opens', () => {
    const { dock, audio, bar } = setup();
    dock.open(episode('a')); Object.defineProperty(audio, 'currentTime', { value: 42, configurable: true });
    expect(dock.started()).toBe(true);
    dock.open(episode('a'));
    expect(audio.getAttribute('src')).toBe('https://media.example/a.mp3'); expect(audio.pause).not.toHaveBeenCalled();
    dock.open({ ...entry, id: 'post' });
    expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.hasAttribute('src')).toBe(false);
    expect(dock.entry).toBeNull(); expect(bar.classList.contains('is-hidden')).toBe(true);
  });
  it('returns to the playing episode from its title and closes from the close button', () => {
    const { dock, audio, onOpen, bar } = setup();
    const a = episode('a'); dock.open(a);
    (bar.querySelector('.qrs-audio-title') as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith(a);
    (bar.querySelector('.qrs-audio-close') as HTMLButtonElement).click();
    expect(audio.hasAttribute('src')).toBe(false); expect(bar.classList.contains('is-hidden')).toBe(true);
  });
});
