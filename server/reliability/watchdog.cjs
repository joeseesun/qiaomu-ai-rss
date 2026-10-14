'use strict';
function watch(worker, { idleMs = 180000, maxMs = 2700000, now = Date.now, log = console.warn } = {}) {
  const started = now(); let progressAt = started, previous = '', stopped = false;
  const tick = () => {
    if (stopped || now() - progressAt < idleMs && now() - started < maxMs) return;
    stopped = true;
    log('[rss-alert]', JSON.stringify({ kind: 'fetch_worker_stalled', at: now() }));
    worker.kill('SIGTERM');
    const force = setTimeout(() => { if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL'); }, 1500); force.unref();
  };
  const timer = setInterval(tick, Math.min(10000, idleMs)); timer.unref();
  worker.on('message', message => {
    if (message?.type !== 'progress') return;
    const value = JSON.stringify([message.done, message.total]);
    if (value !== previous) { previous = value; progressAt = now(); }
  });
  worker.once('exit', () => { stopped = true; clearInterval(timer); });
  return { tick, stop: () => { stopped = true; clearInterval(timer); } };
}
module.exports = { watch };
