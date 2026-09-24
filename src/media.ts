import { setIcon } from 'obsidian';
import { safeUrl, titleOf, type Entry } from './model';
import { t } from './i18n';

export function audioUrl(entry: Entry): string | null {
  if (!entry.audio) return null;
  const url = safeUrl(entry.audio.url);
  if (!url || !url.startsWith('https://')) return null;
  const type = entry.audio.type?.toLowerCase();
  return !type || type.startsWith('audio/') ? url : null;
}

export function youtubeEmbedUrl(link: string | null | undefined): string | null {
  const value = link ? safeUrl(link) : null;
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|live)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2];
  } else if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.slice(1);
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
}

export function stopMedia(root: HTMLElement): void {
  for (const audio of root.querySelectorAll('audio')) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
  }
  for (const frame of root.querySelectorAll('iframe.qrs-video-frame')) frame.removeAttribute('src');
}

// Pause embedded YouTube players while the reader is hidden, e.g. after returning to the list on a phone.
export function pauseVideos(root: HTMLElement): void {
  for (const frame of root.querySelectorAll('iframe.qrs-video-frame')) {
    (frame as HTMLIFrameElement).contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
  }
}

export function renderMedia(article: HTMLElement, entry: Entry): void {
  if (audioUrl(entry)) return;
  const embed = youtubeEmbedUrl(entry.videoUrl || entry.link);
  if (!embed) return;
  article.createEl('iframe', { cls: 'qrs-video-frame', attr: {
    src: `${embed}?autoplay=0&playsinline=1&enablejsapi=1`, allow: 'autoplay; encrypted-media; picture-in-picture',
    sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
    referrerpolicy: 'strict-origin-when-cross-origin', allowfullscreen: '',
    title: t('media.videoPlayer'),
  } });
}

/**
 * One podcast player per reader view, kept outside the article so playback and its
 * controls survive returning to the list or switching channels. Opening another
 * article replaces or stops it.
 */
export class AudioDock {
  entry: Entry | null = null;
  private el: HTMLElement;
  private audio: HTMLAudioElement;
  private title: HTMLButtonElement;
  private error: HTMLElement;
  constructor(parent: HTMLElement, private onOpen: (entry: Entry) => void) {
    this.el = parent.createDiv({ cls: 'qrs-audio-dock is-hidden' });
    // Close sits at the leading edge: Obsidian's status bar overlaps the bottom-right corner.
    const close = this.el.createEl('button', { cls: 'qrs-icon qrs-audio-close' });
    setIcon(close, 'x'); close.createSpan({ cls: 'qrs-visually-hidden', text: t('media.closePlayer') });
    close.addEventListener('click', () => this.stop());
    this.title = this.el.createEl('button', { cls: 'qrs-audio-title' });
    this.title.addEventListener('click', () => { if (this.entry) this.onOpen(this.entry); });
    this.audio = this.el.createEl('audio', { attr: { controls: '', preload: 'none' } });
    this.error = this.el.createEl('p', { cls: 'qrs-media-error is-hidden', text: t('media.audioError') });
    this.audio.addEventListener('error', () => { if (this.audio.getAttribute('src')) this.error.removeClass('is-hidden'); });
    this.audio.addEventListener('play', () => {
      if (!this.entry || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
      navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(this.entry) });
    });
  }
  /** Show the episode of a newly opened article; any other episode stops. */
  open(entry: Entry): void {
    if (this.entry?.id === entry.id) return;
    this.stop();
    const url = audioUrl(entry); if (!url) return;
    this.entry = entry; this.audio.src = url;
    this.title.setText(titleOf(entry)); this.error.addClass('is-hidden'); this.el.removeClass('is-hidden');
  }
  /** Whether the listener has started this episode, so it is worth keeping after they leave the article. */
  started(): boolean { return !!this.entry && (!this.audio.paused || this.audio.currentTime > 0); }
  stop(): void {
    if (this.entry) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
    this.entry = null; this.el.addClass('is-hidden');
  }
}
