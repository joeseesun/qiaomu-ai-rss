'use strict';
const http = require('node:http');
let body = '', size = 0;
process.stdin.on('data', chunk => { size += chunk.length; if (size > 64000) process.exit(1); body += chunk; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(body); if (!['fetch', 'status'].includes(input.action)) throw Error(); }
  catch { process.stdout.write(JSON.stringify({ ok: false, error: 'invalid_request' })); return; }
  const request = http.request({ socketPath: process.env.RSS_AGENT_SOCKET || '/run/qiaomu-rss-fetch/agent.sock', path: '/', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
    let out = '', bytes = 0;
    response.on('data', chunk => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) request.destroy(); else out += chunk; });
    response.on('end', () => process.stdout.write(out));
  });
  request.setTimeout(90000, () => request.destroy(Error('deadline')));
  request.on('error', () => { process.stdout.write(JSON.stringify({ ok: false, error: 'agent_unavailable' })); process.exitCode = 1; });
  request.end(JSON.stringify(input));
});
