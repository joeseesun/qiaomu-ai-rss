// Keep browser source literal: Worker bundling may inject helpers into functions.
export default String.raw`(function installAvailabilityNotice() {
  'use strict';
  const original = window.fetch.bind(window);
  let degraded = false, banner, healthyStreak = 0, generation = 0, checking = false;
  function show(value, primaryFailed = false) {
    degraded = value;
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => show(degraded), { once: true }); return; }
    if (!banner) {
      banner = document.createElement('div'); banner.id = 'rss-availability';
      banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
      banner.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:min(90vw,680px);padding:12px 16px;border-radius:10px;background:#252525;color:white;font:14px/1.5 system-ui;box-shadow:0 2px 12px #0003';
      document.body.appendChild(banner);
    }
    banner.textContent = primaryFailed
      ? '主站连接暂时异常，正在显示备用内容。登录、收藏和生成新内容可能暂不可用，连接稳定后提示会自动消失。'
      : '部分请求响应较慢，当前显示备用内容。登录、收藏等操作仍连接主站。';
    banner.hidden = !value;
    document.documentElement.dataset.rssReadOnly = String(value);
  }
  window.fetch = async function (input, init) {
    const response = await original(input, init);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin === location.origin && response.headers.get('X-Rss-Route') === 'failover') {
      generation++; healthyStreak = 0; show(true);
    }
    return response;
  };
  async function check() {
    if (checking) return;
    checking = true;
    const startedGeneration = generation;
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
      try {
        const r = await original('/__rss_failover/health', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (r.ok) {
          const data = await r.json();
          if (data.mode === 'primary') {
            if (startedGeneration === generation && (!degraded || ++healthyStreak >= 2)) show(false);
          } else {
            healthyStreak = 0;
            if (data.mode === 'read-only') show(true, true);
          }
        } else { healthyStreak = 0; }
      } finally { clearTimeout(timer); }
    } catch { healthyStreak = 0; /* A failed probe must not clear the notice. */ }
    finally { checking = false; }
  }
  void check();
  setInterval(() => { if (!document.hidden || degraded) void check(); }, 15000);
})();`;
