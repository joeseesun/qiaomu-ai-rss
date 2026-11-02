import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('phone reader layout', () => {
  it('keeps the phone status-bar inset without the hidden host header gap', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-header\s*{[^}]*display: none;/);
    expect(css).toMatch(/\.is-phone \.mod-root \.workspace-leaf-content\[data-type="qiaomu-ai-rss-reader"\] > \.view-content\s*{[^}]*margin-top:max\(var\(--safe-area-inset-top,0px\),env\(safe-area-inset-top,0px\)\);/);
    expect(css).toMatch(/\.is-mobile \.qrs-sidebar-toolbar \.qrs-channel\s*{[^}]*min-height:44px;/);
    expect(css).toMatch(/\.is-mobile \.qrs-sidebar-toolbar \.qrs-icon\s*{[^}]*width:44px; height:44px;/);
  });
  it('places selection actions above the mobile bottom controls instead of beside the native text menu', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.is-mobile \.qrs-selection-popup\s*{[^}]*top:auto;[^}]*bottom:calc\(68px \+ var\(--safe-area-inset-bottom/);
  });
  it('limits Explore card introductions to two lines', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.qrs-discovery-card \.qrs-discovery-description\s*{[^}]*-webkit-line-clamp:2;/);
  });
});
