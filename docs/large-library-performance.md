# RSS large-library performance — 0.29.0

This release addresses client-side work that scales with subscriptions and articles. It adds no dependency or server deployment. Baseline is public 0.28.5; verification uses a separate `/tmp/qrs-scale-qa` vault and Obsidian profile, with no personal vault writes.

## Changes

- Variable-height virtual article windows with measured heights, bounded mounted rows, scroll anchors and Tab navigation across window boundaries. Ordinary article lists retain their existing appearance and keyboard actions; the administrator collection list is unchanged.
- Intersection-controlled thumbnail downloads, view cleanup and bounded actual image transports. A UI timeout does not release a still-running transport slot.
- Merged source refresh updates and a retained sorted feed index. Source-name/read/duplicate lookups are indexed per render. Large searches debounce for 120 ms and respect composition events.
- Metadata-only startup and lazy body reads. `bodies-v1` uses 32 shards; only changed shards are written. Legacy migration writes a completion marker last and keeps the old cache as a rollback copy. Unloaded bodies survive ordinary saves; rebuildable bodies are capped at 20 MB independently of protected saved/favorite/recent bodies. Eviction keeps article metadata. Opening an evicted body can fetch its original feed with reserved foreground capacity.
- Personal channel refreshes no longer stop at 20 sources. While a reader exists, a 60–75-second local timer checks due sources; source cadence sets a 5–60-minute interval. Background transports reserve foreground capacity, successful 304 checks persist timing and clear backoff, and obsolete queued work is skipped. Closing the reader stops scheduled queue advancement. No diagnostics are transmitted.
- Personal channel checkpoints no longer duplicate the entire personal article index in data.json. Normal metadata saves skip body-map collection/writes.

## Verification

`npm run check`: 263 Vitest checks, 16 server checks and one i18n bundle check passed; lint has zero errors and eight existing warnings; production build passed. New regressions reproduced metadata loss, stale backoff and validator bypass on the baseline before their fixes.

`node scripts/qa-host.mjs scripts/large-library-benchmark.js` measures the same 100/500/2000-feed fixture with 50 articles per source. Raw baseline and candidate results are in `large-library-qa.json`. Timings cover in-memory merging/filtering/DOM work, not network, disk startup or a production capacity test; individual samples vary with GC and host load. The 100,000-article baseline search was 182 ms; candidate samples were about 20–27 ms. First-render timings are variable and are not claimed as a universal speedup. Deep-list mounted rows fell from 2000 to roughly 12–19 in this viewport.

`large-library-host-qa.js`: 12 desktop assertions cover bounded rows, scroll-anchor pixel preservation, retained focus, Tab across virtual boundaries, IME composition, search/clear, actual lazy thumbnail requests, scrolling, offline reading and narrow layout. Light, dark and narrow screenshots were inspected. Hidden Electron windows must be made visible before relying on IntersectionObserver results.

`body-upgrade-host-qa.js`: eight installed-host assertions cover metadata-only startup/restart, settings/favorites/read-state preservation, on-demand legacy reads, migration completion, one-shard lookup and offline article rendering after upgrade. The test explicitly waits for the old instance's save queue before replacing fixture data.

## Boundaries

- Mobile device hardware is untested; narrow desktop layout is not mobile runtime proof.
- Production public API sampling from this machine encountered timeouts (one 40-entry response returned HTTP 200 then stalled partway; a five-entry request timed out before headers). These observations do not establish whether the bottleneck is the origin, proxy or network. No server capacity or outage recovery claim is made.
- Server aggregation/keyset pagination, database tuning, shared-cache policy changes and worker-based parsing are not part of this client release. Existing public list/cache contracts are preserved. Runtime measurements should guide those separate changes.
- Existing unrelated untracked moderation documents and video assets are excluded from this change.
