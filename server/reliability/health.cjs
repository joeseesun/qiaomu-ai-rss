'use strict';
function evaluate(sources, background, now = Date.now()) {
  const enabled = sources.filter(source => source.enabled && !['user-submitted', 'qiaomu-clippings'].includes(source.id) && (!source.optIn || source.lastAttemptAt));
  const successful = enabled.filter(source => Number(source.fetchedAt) > 0);
  const lastSuccess = Math.max(0, ...successful.map(source => Number(source.fetchedAt)));
  const stale = enabled.filter(source => {
    const maximumAge = source.category === 'news' ? 2 * 3600000 : source.category === 'podcast' ? 12 * 3600000 : 6 * 3600000;
    return !source.fetchedAt || now - source.fetchedAt > maximumAge;
  });
  const fetch = background?.fetch;
  const stalled = !!(fetch?.running && fetch.job?.startedAt && now - fetch.job.startedAt > 45 * 60000);
  const updateStopped = !lastSuccess || now - lastSuccess > 2 * 3600000;
  const status = stalled || updateStopped ? 'critical' : stale.length > Math.max(5, enabled.length / 4) ? 'degraded' : 'ok';
  return { status, at: now, lastSuccess, stalled, updateStopped, sourceCount: enabled.length, staleCount: stale.length, staleSourceIds: stale.map(source => source.id), queued: fetch?.queuedSourceIds?.length || 0 };
}
function middleware(fetcher, background) {
  return (req, res, next) => {
    if (req.path !== '/api/health' || req.method !== 'GET') return next();
    const result = evaluate(fetcher.getSourcesMeta(), background());
    res.set('Cache-Control', 'no-store'); res.status(result.status === 'critical' ? 503 : 200).json(result);
  };
}
module.exports = { evaluate, middleware };
