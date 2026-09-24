/** WeChat feeds prefix every summary with "原创 作者 2026-09-22 10:02 上海"; the list wants the first real sentence. */
const wechatByline = /^(?:原创\s+)?(?:\S+\s+){0,3}?\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s+[一-鿿]{2,3}(?=\s))?\s*/;

export function cleanExcerpt(text: string): string {
  return text.replace(wechatByline, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').trim().slice(0, 160);
}
