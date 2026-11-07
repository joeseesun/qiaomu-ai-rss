# X News versions and inline media — 2026-11-06

## User-visible repair

The service now publishes original HTML separately from the published Chinese rewrite. Qiaomu AI RSS 0.32.11 still held the old combined body; refreshing only updated the list. Its rewrite schema discarded `bodyHtml`, and its article sanitizer removed audio, video and iframe elements.

0.32.13 retains sanitized rewrite HTML, displays native audio/video controls, and converts exact YouTube embed URLs into click-to-load privacy-host players. Arbitrary iframes, handlers and unsafe URLs remain blocked. Article/version changes stop inline players. Podcast dock behavior stays unchanged.

The refresh button also reloads the currently open article while retaining its selected reading mode and scroll checkpoint. Restoring an X News channel revalidates legacy/missing bodies. Shared disk-body writes prefer the newest fetched bundle so an older saved copy cannot restore the mixed original. User notes are not rewritten.

## Evidence

- Three new regression cases failed before the fix: publisher HTML lost, embedded media removed, and older saved-body overwrite.
- 397 Vitest tests, 39 server tests and 3 compression tests passed; ESLint and production build passed. Update notes, versions and asset budget checks passed.
- Obsidian desktop QA, version 0.32.13: actual CaptureFlow, Cursor and DeepSeek entries fetched from the public API, originals distinct from rewrites; Cursor video controls in both modes; YouTube is inert until click; synthetic audio controls and stop-on-version-change verified. No host errors collected.
- Real refresh recovery: seeded the old mixed CaptureFlow body, used the actual refresh action, and verified English original, retained rewrite HTML, corrected cache and reader scroll 100 → 100.
- Current X News feed has no audio item; audio is covered by a synthetic fixture. Third-party stream playback availability and mobile devices are not claimed by DOM/control tests.

Release and installation status are recorded in the delivery message; source/build/official scan/public assets/installed runtime are separate checks.
