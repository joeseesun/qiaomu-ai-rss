# RSS article outline

Updated 2026-10-22 (Asia/Shanghai). Based on main at a5ce40b, retaining the 0.30.2 features. 0.31.0 release candidate; official preview, public assets and formal review must be verified before reporting publication.

The reader now has an RSS outline in the native right dock (native drawer on mobile). It extracts actual rendered headings, preserves duplicate titles and heading order, jumps below the sticky reading controls, and highlights the current section. Switching articles or original/rewrite/translation versions replaces the outline. Native Markdown completion refreshes it, with guards against late renders. Empty and heading-free articles have explicit states. Closing the reader or outline releases listeners, observers and pending animation frames. Ordinary article scrolling uses cached heading positions and a binary search; positions are refreshed after layout changes.

The toolbar order requested by the user is **outline → reading settings → play**. Reading settings are removed from More and exposed beside the outline. Opening/closing settings preserves the article and reading position. These controls use quieter theme-aware colors with clear hover and playback states. Compact layouts retain the four actions (including More), with wrapping for extremely narrow panes.

Verification:

- `npm run check`: lint has zero errors and ten pre-existing warnings; 302 client tests, 31 server checks, the i18n production-bundle check, typecheck and build passed.
- Six outline tests cover heading hierarchy/duplicates, translation safety, exact navigation, scroll tracking without repeated measurements, layout changes and cleanup.
- Obsidian 1.13.7, isolated `qrs-outline-qa`: 21 native checks passed in `scripts/outline-host-qa.js`. Includes duplicate-heading navigation, end-of-article tracking, settings toggle without rebuilding prose, version switches, asynchronous Markdown, late-render protection, close/reopen and stable outline focus targets.
- Inspected native screenshots in light, dark, paper and narrow layouts. In the narrow layout the four controls are 40 px wide and the toolbar has no horizontal overflow. Also checked a 119 px pane with both native docks expanded: toolbar wraps without overflow.
- Installed the candidate assets into the daily vault and reloaded the plugin, preserving data and caches. Runtime reports one reading-settings button and the requested outline/settings/speech order.

Not covered: physical mobile devices, detached windows, official preview/release scanning or a new public release. Eight locales contain the new messages; native visual checks used Chinese.
