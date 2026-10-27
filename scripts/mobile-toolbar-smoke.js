// Evaluate this expression in Obsidian. Uses real host CSS and a disposable copy of the
// rendered sidebar; no user settings, subscriptions or reading state are changed.
(async () => {
  const view = app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0]?.view;
  if (!view) throw Error('Open the RSS reader first');
  const doc = view.contentEl.ownerDocument;
  const host = doc.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white;overflow:auto;pointer-events:none';
  doc.body.append(host);
  const results = [];
  const originalTheme = doc.body.className;
  try {
    for (const theme of ['theme-light', 'theme-dark']) for (const platform of ['desktop', 'is-mobile is-phone', 'is-mobile is-tablet']) {
      for (const width of [220, 280, 320, 390, 600, 768, 1024]) for (const collection of [false, true]) {
        doc.body.classList.remove('theme-light', 'theme-dark'); doc.body.classList.add(theme);
        host.className = platform;
        host.replaceChildren();
        const root = doc.createElement('div'); root.className = 'view-content qrs-root';
        root.style.cssText = `width:${width}px;height:600px;max-width:none`;
        const sidebar = view.contentEl.querySelector('.qrs-sidebar').cloneNode(true);
        sidebar.style.height = '100%'; root.append(sidebar); host.append(root);
        sidebar.querySelector('.qrs-channel-label').textContent = '这是一个很长的订阅频道名称 — A very long channel name';
        const settings = sidebar.querySelector('.qrs-sidebar-toolbar [data-qrs-label]:last-child');
        settings.classList.toggle('is-hidden', !collection);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const bar = sidebar.querySelector('.qrs-sidebar-toolbar'), bounds = bar.getBoundingClientRect();
        const controls = [...bar.querySelectorAll('button')].filter(b => getComputedStyle(b).display !== 'none');
        for (const button of controls) {
          const b = button.getBoundingClientRect(), svg = button.querySelector('svg')?.getBoundingClientRect();
          if (!svg || svg.width < 12 || svg.height < 12) throw Error(`Invisible icon: ${platform} ${width} ${button.textContent}`);
          if (b.left < bounds.left || b.right > bounds.right + 1 || b.bottom > bounds.bottom + 1) throw Error(`Clipped control: ${platform} ${width} ${button.textContent}`);
          if (platform !== 'desktop' && (b.height < 44 || (button.classList.contains('qrs-icon') && b.width < 44))) throw Error(`Small touch target: ${platform} ${width}`);
        }
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) throw Error(`Overlapping controls: ${platform} ${width}`);
        }
        if (sidebar.scrollWidth > width + 1) throw Error(`Horizontal overflow: ${platform} ${width}`);
        results.push({ theme, platform, width, collection, buttons: controls.length, toolbarHeight: bounds.height });
      }
    }
    return { cases: results.length, results };
  } finally { host.remove(); doc.body.className = originalTheme; }
})()
