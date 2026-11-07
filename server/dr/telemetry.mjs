// Never log URLs, query strings, headers, bodies, user IDs or raw error text.
export function routeClass(request) {
  const p = new URL(request.url).pathname;
  if (p === '/api/health' || p === '/__rss_failover/health') return 'health';
  if (/^\/api\/(entries|sources)(\/|$)/.test(p)) return 'catalog';
  if (p.startsWith('/api/entry/')) return 'article';
  if (p.startsWith('/api/auth/')) return 'auth';
  if (p.startsWith('/api/')) return 'private-api';
  return p === '/' || p.endsWith('.html') ? 'page' : 'asset';
}
export function failureCode(error) {
  const code = error?.message;
  if (['origin_timeout', 'replica_deadline', 'invalid_content_type', 'response_too_large', 'invalid_protocol', 'standby_not_ready', 'standby_generation_mismatch', 'standby_frontend_mismatch', 'standby_invalidated', 'gate_unavailable'].includes(code)) return code;
  if (error?.name === 'SyntaxError') return 'invalid_json';
  if (error?.name === 'AbortError') return 'origin_timeout';
  return 'connection_error';
}
export function emitOrigin(request, env, detail) {
  if (env.ORIGIN_LOGS !== 'true') return;
  // Keep all failures, sample successes. Disable invocation logs in Wrangler so
  // the application allowlist below is the only request information persisted.
  if (detail.reason === 'ok' && Math.random() >= Number(env.ORIGIN_SUCCESS_SAMPLE_RATE || 0.1)) return;
  console.log(JSON.stringify({ event: 'rss_origin', traffic: env.RSS_DIAGNOSTIC_SCENARIO ? 'drill' : 'live', route: routeClass(request), method: request.method,
    colo: request.cf?.colo || null, ...detail }));
}
