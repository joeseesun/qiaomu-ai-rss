'use strict';
function validate(source, result, now = Date.now()) {
  if (!result || result.status !== 'ok' || !Number.isFinite(result.fetchedAt) || result.fetchedAt > now + 60000 || now - result.fetchedAt > 12 * 3600000 || !Array.isArray(result.entries) || !result.entries.length || result.entries.length > 30) throw Error('invalid_remote_result');
  if (JSON.stringify(result).length > 12 * 1024 * 1024) throw Error('remote_result_too_large');
  return result.entries.map(entry => {
    if (!entry || entry.sourceId !== source.id || !/^[a-zA-Z0-9_/-]{1,200}$/.test(entry.id) || typeof entry.title !== 'string' || entry.title.length > 1000 || String(entry.content || '').length > 3000000) throw Error('invalid_remote_entry');
    // Asset, permission, deletion and private-account fields never cross this boundary.
    const fields = ['id', 'sourceId', 'title', 'link', 'author', 'published', 'publishedTs', 'publishedRelative', 'summary', 'content', 'image', 'audio', 'contentHash', 'originalFetchedAt', 'originalFetchAttemptedAt', 'originalFetchError', 'podcastViews', 'podcastWordCount', 'podcastDurationSeconds'];
    return Object.fromEntries(fields.filter(key => entry[key] !== undefined).map(key => [key, entry[key]]));
  });
}
module.exports = { validate };
