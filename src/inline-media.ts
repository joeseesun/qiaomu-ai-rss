import { safeUrl } from './model';
import { t } from './i18n';

function inlineYoutube(value: string | null): string | null {
  const safe = value && safeUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) return null;
  return /^\/embed\/([\w-]{11})\/?$/.exec(url.pathname)?.[1] || null;
}

/** Called on an inert sanitized fragment, before any frame reaches the live document. */
export function prepareInlineMedia(fragment: DocumentFragment, base: string | undefined, images: boolean): void {
  const doc = fragment.ownerDocument;
  for (const frame of fragment.querySelectorAll('iframe')) {
    const id = inlineYoutube(frame.getAttribute('src'));
    if (!id) { frame.remove(); continue; }
    const wrapper = doc.createElement('div'); wrapper.className = 'qrs-inline-video';
    const button = doc.createElement('button'); button.type = 'button'; button.textContent = t('media.loadVideo');
    const fallback = doc.createElement('a'); fallback.href = `https://www.youtube.com/watch?v=${id}`;
    fallback.textContent = t('media.openOriginal'); fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
    button.addEventListener('click', () => {
      if (wrapper.querySelector('iframe')) return;
      const player = doc.createElement('iframe'); player.className = 'qrs-video-frame';
      player.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&playsinline=1&enablejsapi=1`;
      player.title = t('media.videoPlayer'); player.allow = 'encrypted-media; picture-in-picture';
      player.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
      player.referrerPolicy = 'strict-origin-when-cross-origin'; player.allowFullscreen = true;
      button.hidden = true; wrapper.prepend(player);
    });
    wrapper.append(button, fallback); frame.replaceWith(wrapper);
  }
  for (const media of fragment.querySelectorAll<HTMLMediaElement>('audio,video')) {
    media.controls = true; media.preload = 'none'; media.removeAttribute('autoplay');
    media.setAttribute('playsinline', '');
    for (const node of [media, ...media.querySelectorAll('source,track')]) {
      const raw = node.getAttribute('src'), url = raw && safeUrl(raw, base);
      if (url) node.setAttribute('src', url); else node.removeAttribute('src');
    }
    const poster = media.getAttribute('poster'), safePoster = images && poster && safeUrl(poster, base);
    if (safePoster) media.setAttribute('poster', safePoster); else media.removeAttribute('poster');
    const url = media.getAttribute('src') || media.querySelector('source[src]')?.getAttribute('src');
    if (!url) continue;
    const fallback = doc.createElement('a'); fallback.href = url; fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
    fallback.textContent = t('media.openOriginal');
    const line = doc.createElement('p'); line.className = 'qrs-media-link'; line.append(fallback); media.after(line);
    media.addEventListener('error', () => { fallback.textContent = t('media.unavailable'); });
  }
}
