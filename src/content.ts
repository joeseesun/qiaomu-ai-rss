import createDOMPurify from 'dompurify';
import { marked } from 'marked';
import { safeUrl, type Bundle, type Mode } from './model';
import { fail, t } from './i18n';
import { wechatProxyArticle } from './wechat-articles';
const tags = ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 's', 'del', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'div', 'span', 'sup', 'sub'];
export function articleFragment(bundle: Bundle, mode: Mode, doc: Document, images: boolean): DocumentFragment | null {
  const win = doc.defaultView;
  if (!win) fail('error.windowUnavailable');
  const purifier = createDOMPurify(win);
  let html: string;
  if (mode === 'rewrite') {
    if (!bundle.rewrite?.body.trim()) return null;
    html = marked.parse(bundle.rewrite.body, { async: false });
  } else if (mode === 'translation') {
    if (!bundle.translation?.content?.length) return null;
    html = bundle.translation.content.map(pair => {
      if (pair.target?.trim()) {
        // Translation text is authoritative; HTML supplies only a safe heading level.
        // Sanitizing into an inert fragment avoids fetching source media while inspecting it.
        let tag = 'p';
        for (const raw of [pair.targetHtml, pair.sourceHtml]) {
          if (!raw?.trim() || !/^<h[1-6](?:\s|>)/i.test(raw.trim())) continue;
          const structure = purifier.sanitize(raw.trim(), { RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: tags, ALLOWED_ATTR: [] });
          const only = structure.childNodes.length === 1 ? structure.firstElementChild : null;
          if (only && /^H[1-6]$/.test(only.tagName)) { tag = only.tagName.toLowerCase(); break; }
        }
        return `<${tag}>${escapeHtml(pair.target)}</${tag}>`;
      }
      return pair.targetHtml || '';
    }).join('\n');
    if (!html.trim()) return null;
  } else {
    html = bundle.entry.content?.trim() || '';
    if (!html) return null;
  }
  const fragment = purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true, ALLOWED_TAGS: images ? tags : tags.filter(tag => tag !== 'img'),
    ALLOWED_ATTR: ['href', 'src', 'alt'], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  for (const element of fragment.querySelectorAll('a, img')) {
    const attr = element.tagName === 'A' ? 'href' : 'src';
    const raw = element.getAttribute(attr);
    let url = raw ? safeUrl(raw, bundle.entry.link || undefined) : null;
    if (url && element.tagName === 'A') {
      const original = wechatProxyArticle(url);
      if (original) {
        url = original;
        if (/^跳转(?:到)?微信打开$/.test(element.textContent?.trim() || '')) element.textContent = t('reader.wechatOriginal');
      }
    }
    if (url) element.setAttribute(attr, url);
    else element.removeAttribute(attr);
    if (element.tagName === 'A') {
      element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer');
    } else {
      element.setAttribute('loading', 'lazy'); element.setAttribute('referrerpolicy', 'no-referrer');
    }
  }
  return fragment;
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
