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

Desktop and 390px screenshots; real loaded article images and list thumbnails with nonzero natural dimensions and Blob URLs; resize/persistence; sidebar focus toggle retaining scroll; grouped channel modal; keyboard next/previous; correct icons; Daily Note append/split; offline image cache; no runtime errors or horizontal overflow.

## Personal subscriptions (0.2.0)

Keep the reading surface unchanged. A single plus icon in the existing list toolbar opens a native subscription manager. The searchable channel picker contains Qiaomu, My Subscriptions, group paths and individual feeds. Names/groups are edited in a native modal, with explicit unsubscribe confirmation preserving favorites/notes. OPML uses a preview before importing; export writes a vault file. Personal article mode is original-only so unavailable AI actions do not occupy the reader. Empty/error states explain add/refresh actions.

## Personal library and discovery (0.20.0)

See [the implementation plan](docs/PERSONAL-LIBRARY-PLAN.md) for the approved discovery page, unified personal subscriptions, groups, OPML selection, source icons, migration and verification. This supersedes earlier add-menu/discovery-modal designs. The plus button opens discovery directly; subscription management belongs to the personal library.

## Channel picker and subscription center (0.20.0 revision)

Reading and maintenance are separated. The channel picker is for reading only and has two sections:

- **乔木精选**: 全部精选 mixes every editorial channel; built-in groups (微信公众号, 小宇宙, YouTube, Newsletter, 资讯, 博客与网站) are filters (`@qiaomu:<group>`) that merge the latest entries of their channels by time. A chevron expands a group to pick one channel.
- **我的订阅**: 全部订阅, then the user's groups (click = read the whole group, chevron = expand), then ungrouped sources.

Search flattens everything and shows each result's parent as a subtitle. A bordered `管理订阅` button beside the picker search opens the **订阅中心**, one large dialog (≤1080×820, full-screen on phones) with underline tabs `订阅管理 · N` and `发现订阅`. Both panels stay mounted while the dialog is open so switching tabs keeps search, scroll and selection. 订阅管理 owns search, type chips, collapsible groups with select-all and `…` menus, sticky bulk actions and OPML/local-content actions; 发现订阅 has search/URL preview and pill filters 推荐 / 公众号 / 播客 / 独立博客和其他. The library action row is always visible: 新建分组 / 添加本地文件夹或笔记 / 导入 OPML / 导出 OPML, with the source count right-aligned. New local sources are ungrouped by default. Discover has no language/topic filters and no manual catalog update (the catalog ships with the plugin); the section heading shows a quiet `N 个来源` count, and dedupe/provenance live in an 11px faint footnote under the list. In the picker, 全部精选/全部订阅 are semibold at depth 0, groups and ungrouped sources indent one level, and expanded channels indent two levels in muted text. The plus button, settings entry and commands open the same dialog on the relevant tab. The earlier standalone Discover/Library pages are retired; saved workspaces that restore them close those tabs automatically.

Group names that differ only by case, spacing or known aliases (Podcasts/Podcast/播客, Blog/Blogs/博客) merge into one group, and renaming a group onto an existing name merges them. The 独立博客和其他 catalog deduplicates by normalized feed URL, then by normalized site and title.

## Monochrome palette (0.20.0)

Plugin surfaces use Vercel-like neutral tokens (`--qrs-fg`, `--qrs-muted`, `--qrs-faint`, `--qrs-bg`, `--qrs-subtle`, `--qrs-hover`, `--qrs-border`, `--qrs-border-strong`) and override Obsidian's accent variables inside plugin scopes, so no purple appears in buttons, focus rings, checkboxes, toggles or selected rows. Primary actions are black-on-white (inverted in dark mode); red is reserved for errors and destructive actions.
