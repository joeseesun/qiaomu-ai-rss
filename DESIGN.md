# Reading-first UI

## Intent and contract

A quiet, dense RSS reader inside Obsidian. The content is the primary focus. The user must see a useful article immediately after selection, switch articles without returning to a dashboard, and save the current version as a note. Preserve native theme integration and existing article/API behavior.

Direction fixed by user feedback: default image display, compact navigation, adjustable list width, accurate icons. This is a focused revision of the working reader, not an open-ended visual-style selection. Visual variance 3/10 (familiar), motion 1/10 (instant reading actions), list density 8/10 and article density 4/10 (fast scan, comfortable reading).

## Primary references, checked 2026-09-07

- [Readwise appearance](https://docs.readwise.io/reader/docs/faqs/appearance): collapsible reading panels and preferences for hiding them. Transfer: one-button list collapse, `[`, retained reading position.
- [Readwise navigation](https://docs.readwise.io/reader/docs/faqs/navigation): keyboard-driven reading and command discovery. Transfer: local `j` / `k`, `/`, and native searchable channel picker.
- [Readwise long-form reading](https://docs.readwise.io/reader/guides/workflows/longform-reading): put triage controls behind reading. Transfer: remove global search/filter/status header; one compact 44px reading toolbar (52px narrow).
- [RSSFlow official docs](https://github.com/Pizone-ai/RSSFlow-doc): compact sidebar article triage, minimal density, and separate Zen Reader. Transfer: tight rows, Chinese excerpts, optional sidebar, no dashboard above the article.
- [Lucide](https://lucide.dev/icons): use Obsidian's bundled Lucide SVG icons, not approximations or emoji. State: `circle-check` read / `circle` unread; `bookmark` outlined/filled favorite; `file-plus-2` save a note; `panel-left-close/open` sidebar visibility; chevrons for previous/next.

## Layout and behavior

- Desktop: default 300px article list, 1px divider with 9px drag hit region, remaining width for article. List width adjustable 220–520px, keyboard arrows on the separator adjust by 20px, double-click resets to 300px. Clamp rendered list width to retain at least 330px for reading.
- List header: channel picker and search/refresh icons. Three compact filter buttons. Search input appears on demand. Only errors occupy a status row.
- Reading: one 44px toolbar with list toggle, version select, article navigation and bookmark/read/note actions. External link and reload in native menu. Source/date/AI label share one metadata line.
- At ≤650px: list and article are separate screens, so list controls consume no reading height. Toolbar actions remain reachable without hover. Previous/next chevrons hide in narrower panes; keyboard navigation remains available.
- Article text: native font, 17px desktop / 16px narrow, 1.9 line height, max-width 780px including padding. Images retain their natural aspect ratio and never exceed the column.
- Persist width and local reading state. Opening an article records read state even if the article is served from cache. Keep the current article in the unread view while navigating, so a read-state update cannot make navigation jump.
- Images: sanitize HTML first, strip network `src` before insertion, download raster bytes through Obsidian, cache within this plugin's vault directory, then render a local Blob URL. Lazy loading, retry on failure, 8 MB per image, 64 MB/100-file disk cap. Revoke Blob URLs when replacing/closing the view. SVG/HTML payloads are not displayed as images.

## Theme and interaction rules

Use Obsidian theme variables. No imported fonts, marketing hero, dashboard statistics, global status banner, or permanent large search field. Keep row selection subtle, unread dots explicit, focus rings visible, article scroll separate from list scroll, and keyboard actions local to this view. Respect reduced motion for refresh indicators.

## Acceptance

Desktop and 390px screenshots; real loaded image with nonzero natural dimensions and Blob URL; resize/persistence; sidebar focus toggle retaining scroll; search/channel modal; keyboard next/previous; correct icons; note export; offline image cache; no runtime errors or horizontal overflow.
