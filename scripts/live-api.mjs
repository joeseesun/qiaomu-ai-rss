import assert from 'node:assert/strict';
const base = process.env.RSS_API_URL || 'https://rss.qiaomu.ai';
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path);
  return response.json();
}
const sources = await get('/api/sources?ready=rewrite');
assert.ok(sources.sources.length > 0);
const { entries } = await get('/api/entries?limit=2&ready=rewrite');
assert.ok(entries.length > 0);
const entry = entries[0];
assert.equal(typeof entry.id, 'string');
const path = `/api/entry/${encodeURIComponent(entry.id)}`;
const [detail, rewrite, translation, page] = await Promise.all([
  get(path), get(path + '/rewrite'), get(path + '/translation'),
  get(`/api/sources/${encodeURIComponent(entry.sourceId)}/entries?limit=2&ready=rewrite`),
]);
assert.equal(detail.entry.id, entry.id);
assert.ok('rewrite' in rewrite && 'translation' in translation);
assert.ok(Array.isArray(page.entries));
if (page.hasMore) {
  assert.ok(page.nextCursor);
  const next = await get(`/api/sources/${encodeURIComponent(entry.sourceId)}/entries?limit=2&ready=rewrite&cursor=${encodeURIComponent(page.nextCursor)}`);
  assert.ok(next.entries.every(item => !page.entries.some(first => first.id === item.id)));
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), base, sources: sources.sources.length, entries: entries.length, detail: true, rewrite: !!rewrite.rewrite, translationAvailable: !!translation.translation, pagination: !!page.hasMore }, null, 2));
