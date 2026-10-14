// Shared pipeline for the existing durable queue. Providers remain server-owned.
function createProcessLink({ fetcher, deepseek, prepareEntryForAiAsset, collectionTitle }) {
  return async (url, progress = () => {}) => {
    progress('fetch');
    const existing = typeof fetcher.getSubmittedEntryByUrl === 'function' ? fetcher.getSubmittedEntryByUrl(url) : null;
    const entry = existing || await fetcher.submitLink(url, { displayName: '乔木 RSS 实验室' });
    const prepared = await prepareEntryForAiAsset(entry, 'Lab link rewrite');
    progress('translation');
    const localized = await collectionTitle(prepared.entry, { deepseek, fetcher });
    const text = String(prepared.entry.content || prepared.entry.summary || '').replace(/<[^>]*>/g, ' ').slice(0, 6000);
    if (deepseek.isLikelyEnglish(`${entry.title || ''}\n${text}`)) {
      const result = await deepseek.translateEntry(prepared.entry, { author: '向阳乔木', temperature: 0.15, maxTokens: 6000 });
      if (!result.translation?.content?.length) throw new Error('Translation not ready');
    }
    progress('rewrite');
    const result = await deepseek.rewriteEntry(prepared.entry, { author: '向阳乔木', temperature: 0.6, maxTokens: 9000 });
    if (!result.rewrite?.body) throw new Error('Rewrite not ready');
    return { entryId: entry.id, ...localized };
  };
}
module.exports = { createProcessLink };
