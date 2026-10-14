'use strict';
const { fork, spawn } = require('node:child_process');
const children = new Set();
const LIMIT = 12 * 1024 * 1024;
function isolated(file, input, { timeout = 60000, env = process.env, executable = process.execPath, args = [], ssh = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = ssh ? spawn(executable, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }) : fork(file, [], { env, execPath: executable, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.add(child);
    let result, failure, output = '', bytes = 0, finished = false;
    const timer = setTimeout(() => { failure = Object.assign(Error('source_deadline'), { code: 'SOURCE_TIMEOUT' }); child.kill('SIGKILL'); }, timeout);
    function finish(error) {
      if (finished) return;
      finished = true; clearTimeout(timer); children.delete(child);
      if (error) reject(error); else resolve(result);
    }
    child.on('error', error => { failure = error; });
    child.on('message', message => {
      if (message?.ok) result = message.result;
      else if (message?.error) failure = Error(String(message.error).slice(0, 200));
    });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > LIMIT) { failure = Error('source_response_too_large'); child.kill('SIGKILL'); }
      else if (ssh) output += chunk;
    });
    // Child stderr can contain upstream URLs. Never relay credentials or raw logs.
    child.stderr.on('data', () => {});
    child.on('close', code => {
      if (ssh && !failure && !code) {
        try { const value = JSON.parse(output); if (!value.ok) throw Error(value.error || 'remote_fetch_failed'); result = value.result; }
        catch (error) { failure = error; }
      }
      finish(failure || (code || result === undefined ? Error('source_worker_failed') : null));
    });
    if (ssh) { child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input)); }
    else child.send(input, error => { if (error) { failure = error; child.kill('SIGKILL'); } });
  });
}
function stopChildren() { for (const child of children) child.kill('SIGKILL'); }
module.exports = { isolated, stopChildren };
