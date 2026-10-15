# Reader toolbar refinement — 0.29.1

The redundant article save/open button moves into More. Read aloud, favorite, read/unread and Daily Note remain one-click actions, with user-requested custom neutral tips. Other icons and host UI retain their existing behavior. Existing translations provide the labels; no new provider, dependency or network behavior is added.

Tips wait 450 ms on mouse hover, appear on keyboard focus, remain hoverable, dismiss on Escape/click/blur/scroll/resize, and stay inside the viewport. The first Escape dismisses the tip without leaving focused reading. Each has `role=tooltip` and a temporary `aria-describedby`; the existing hidden button text remains its accessible name. No `title`, host tooltip API or tooltip-triggering `aria-label` is used. Favorite/read state changes preserve keyboard focus; speech text switches between read/pause/resume without changing playback behavior. View disposal removes timers, observers, listeners and popup nodes.

Design reference: [WAI tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/), inspected 2026-10-16; the APG labels this pattern work in progress. Reused project's monochrome popup tokens, rather than adopting host tooltip styling.

## Evidence

- `npm run check`: lint (existing warnings only), TypeScript, 268 Vitest tests, 31 server checks, i18n and build passed.
- Five new tip tests cover delayed hover, keyboard focus, Escape, preserving preexisting descriptions, hoverable content, label changes, touch exclusion, pending cancellation, scrolling and disposal. jsdom does not model keyboard modality; keyboard focus-visible is represented in that fixture and separately verified with actual Tab events below.
- Isolated Obsidian 1.14.4, `/tmp/qrs-scale-qa`, native 0.29.0 installation upgraded to candidate 0.29.1. CDP mouse/key input exercised 19 assertions: four labels/delay, no host tooltip overlap, read/favorite toggles, real Tab focus, focus retained after Space activation, Escape focus behavior, dark neutral colors, 440px window bounds, no horizontal overflow, and More retains default save/location actions. All passed.
- The saved-note state was separately exercised: More offered open/another-copy/location actions and opening the existing QA Markdown file succeeded. No note data was written by this verification.
- Actual light/dark/narrow screenshots were inspected; the keyboard ring was reduced to one neutral 1px outline. Screenshots and JSON results are retained in ignored `artifacts/toolbar-tips/`.
- Unit/lifecycle coverage is distinct from hardware QA. Touch exclusion is synthetic; mobile hardware and fresh audio-provider playback were not tested. Existing playback start/pause implementation is unchanged.

The ordinary workspace's preexisting untracked administrator/lab notes and videos were not included. Development used an attached managed worktree and preserved prior server-only changes on main. This document describes candidate validation; official preview, release and native update evidence is recorded separately under `artifacts/release-0.29.1/`.


## Curated-source picker follow-up

The source picker is available through unguarded reader/settings/command entries to every plugin user. It persists `pickedSourceIds` in the current vault; `applyCuratedPicks` filters the local curated cache, exempting personal RSS, vault notes and explicitly followed podcasts. It does not mutate the server catalog. UI copy now explains scope and recovery in all eight languages instead of exposing request thresholds and page sizes.

The original native modal reproduced a 15px rendered search height despite its 36px CSS height, a 3px host focus shadow, and footer bounds outside the modal. The fix prevents controls shrinking, bounds the modal, scrolls the source list, wraps long URLs, uses a single neutral border and provides a native label without a host tooltip attribute.

Native 100-source fixture: 16 assertions passed across light/dark 1200×800, narrow 440×800 and short 700×500 windows. Search remained 36px; focus shadow was none; footer remained visible; no horizontal overflow; actual typing filtered sources, clearing restored them, Tab reached facets and Escape closed the modal. Screenshots inspected and retained with `picker-qa.json` in ignored artifacts. This is desktop native QA, not mobile hardware verification. Final full `npm run check` passed with unchanged preexisting lint warnings.
