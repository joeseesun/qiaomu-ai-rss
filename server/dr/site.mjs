// Only assets from the trusted Reader public tree, never arbitrary origin paths.
const files = new Set(['/', '/index.html', '/app.js', '/styles.css', '/request-json.js',
  '/ai-settings.js', '/ai-settings.css', '/ai-providers.js', '/provider-icons.js',
  '/web-collection.js', '/web-collection.css', '/workbench.js', '/workbench.css',
  '/lucide-icons.js', '/purify.min.js', '/podscribe.js', '/podscribe.css', '/favicon.svg', '/privacy.html', '/support.html']);
export function siteRead(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  const u = new URL(request.url);
  if (files.has(u.pathname)) return true;
  if (/^\/articles\/[A-Za-z0-9_%~-]+(?:\/(?:rewrite|translation))?\/?$/.test(u.pathname)) return true;
  if (/^\/assets(?:\/(?:rewrite|translation|comments|annotations|chat))?\/?$/.test(u.pathname)) return true;
  return /^\/vendor\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|woff2?|svg|png)$/.test(u.pathname);
}
export function siteType(path) {
  if (path.endsWith('.js')) return /(?:java|ecma)script/;
  if (path.endsWith('.css')) return /^text\/css/;
  if (path.endsWith('.svg')) return /^image\/svg\+xml/;
  if (path.endsWith('.png')) return /^image\/png/;
  if (/\.woff2?$/.test(path)) return /^(?:font\/|application\/font)/;
  return /^text\/html/;
}
// Do not send sessions, bearer tokens, user AI keys or arbitrary headers to replicas.
export function anonymousRequest(request) {
  const headers = new Headers();
  for (const name of ['Accept', 'Accept-Encoding', 'X-Rss-List']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  return new Request(request.url, { method: request.method, headers });
}
export async function injectStatusClient(response, request) {
  if (request.method !== 'GET' || response.status !== 200 ||
      !response.headers.get('Content-Type')?.includes('text/html')) return response;
  // The caller has already bounded and buffered public HTML.
  let html = await response.text();
  const script = '<script src="/__rss_failover/client.js"></script>';
  html = html.includes('</head>') ? html.replace('</head>', script + '</head>') : script + html;
  const h = new Headers(response.headers);
  for (const name of ['Content-Length', 'Content-Encoding', 'ETag']) h.delete(name);
  h.set('Cache-Control', 'no-store');
  return new Response(html, { status: response.status, headers: h });
}
