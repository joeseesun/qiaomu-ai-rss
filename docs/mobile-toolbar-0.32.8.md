# Mobile toolbar repair — 2026-10-27

The tablet host rule `.is-tablet button:not(.clickable-icon)` overrides icon-button padding with 20px on each side. A 40px button then gives its flexing SVG 0px width. Reproduced in Obsidian 1.14.5 with tablet classes; the old toolbar also clips its collection settings action at 220px.

Use native icon-button classes, non-shrinking SVGs, wrapping sidebar action groups and 44px mobile targets. No subscriptions, filtering behavior or persisted data schema changed.

Validation: 318 Vitest tests, server checks, i18n checks, ESLint and production build passed. `scripts/mobile-toolbar-smoke.js` evaluates the rendered sidebar against real host styles: 84 combinations of desktop/phone/tablet, light/dark, 220/280/320/390/600/768/1024px and collection settings hidden/visible. It checks nonzero SVG bounds, control overlap, clipping, touch sizes and horizontal overflow, and restores temporary DOM/theme state. The old build fails this regression. Screenshots at 320px and 600px inspected in both themes. Installed runtime reload verified; refresh click invokes one forced reload and clears its loading state, and search opens correctly.

Physical iOS/Android devices are not tested. Release scanning, public assets and official installation must be verified separately against the final commit.
