# Production RSS API latency work — 2026-10-15

## Scope and source ownership

This is a server-only change; plugin release stays 0.29.0. Hostinger remains the sole writer, Vultr serves a public read-only snapshot and independent fetch work, and Aliyun retains feed infrastructure. No private accounts, credentials, or write endpoints move to standby. Website UI/login/bootstrap work is coordinated separately in the QMReader repository; that owner performs the next application deployment and must retain the prepared-cache patch.

The deployed website is not a Git checkout and contained unrelated production changes. Only the guarded API insertion and cache module were replaced, with exact backups. The new website recovery branch will absorb these files into its own source tree. No wholesale deployment from the unrelated dirty local website checkout was performed.

## Findings and changes

The website's newer prepared response path called `res.end` directly, bypassing the old `res.json` compaction middleware. A 40-row plugin list contained about 119 KB raw, including 74 KB of asset metadata. The repaired response measured 38,942 raw bytes (67% smaller), or 15,433 gzip bytes versus 28,628 (46% smaller), on the paired production sample. Legacy response IDs remained identical and legacy assets were retained. Subsequent live lists vary as ingestion continues.

The prepared cache now invalidates on SQLite/WAL or JSON changes, isolates compact/legacy keys and validators, limits estimated memory to 32 MiB, and prevents invalidated async fills from repopulating. Standby adds gzip and compact-list shaping. The Worker conditionally prefers fresh standby snapshots for anonymous compact list reads from Asia/Oceania, with a 90-second freshness bound and 1.2-second total preference budget; stale/slow/invalid snapshots return to primary. Deletion coordination is rechecked after the body arrives.

## Live evidence

- Primary warm loopback list: approximately 4 ms before changes; cold compact sample after changes: approximately 39 ms. There was no evidence that primary CPU or disk capacity caused this incident.
- Public API from Vultr after deployment: four complete HTTP 200 responses, 40 rows each, 0.47–1.21 seconds; no heavyweight fields in compact rows.
- After standby compression, two paired ordinary list requests hit standby in 1.007/0.689 s (snapshot age 70/71 s, gzip 15,215 bytes); explicit no-cache requests hit primary in 0.639/0.769 s (gzip 15,341 bytes). All returned 40 rows.
- An earlier fresh snapshot produced a real `X-Rss-Origin: standby`, `X-Rss-Route: replica-first`, age 68 seconds response, 40 rows, 1.392 seconds. This demonstrates traffic sharing, not that standby is always faster than primary.
- Real protected failure drills, without stopping the primary: simulated 500 returned 40 rows via standby in 1.029 s; timeout in 5.345 s; invalid JSON in 0.361 s. Ten concurrent standby compact reads returned valid 40-row lists.
- Mac ordinary DNS resolved to Fake-IP 198.18.0.192. Before the payload fix a 20-second request timed out part-way through the body; afterward a complete compact response still took 12.77 seconds. Same hostname, TLS and API with `curl --resolve rss.qiaomu.ai:443:104.21.65.71` returned HTTP 200 in 0.933 seconds (TTFB 0.904 s, gzip 15,341 bytes). No system-wide proxy/DNS settings were changed here.
- Strict origin/replica list parity was not claimed: one new article, `fc50501c1c430e162bab8a5be5b450e1`, appeared on origin after snapshot creation. Its `originalFetchedAt` was 1792072379020 versus snapshot timestamp 1792072292255. Remaining common IDs retained order. Freshness routing and deletion protection remain required; snapshots are not real-time replicas.

## Deployment identity and rollback

Primary backup directory: `/opt/qiaomu-backups/qmreader-read-latency-20261015-1347`.

| Component | Deployed SHA256 / version |
| --- | --- |
| QMReader `server.js` after narrow patch | `b0706cac55fc3a1fe3c70fa01ba39acf6a758298512792d36a5abf6fea2c3c5b` |
| QMReader `lib/response-cache.js` | `aa487b59aecd8a9ea0c4747dbb6de710dd0dd3007854442fb63807f31411d1d3` |
| Existing external `public-read-cache.cjs` (unchanged) | `c4ee468e6063a306a1d60558c5bb2134dfa963f29f41eee5c39cbe4717364b8d` |
| Vultr `standby.py` | `3084a9aea2197473fc32085a7b923d34ef4059edcda6acec2fe58aabbbf691cc` |
| Worker deployment | `40dde93c-eb2d-4e4b-a7d6-587b6467e230` |
| Previous Worker version | `865eaa64-230d-42c0-8051-e3ef5666f97a` |

Primary rollback before any subsequent website deployment: restore the two backed-up files, syntax-check, restart only qmreader and verify health/list routes. After a later deployment, revert the patch in current source instead of restoring an older whole server file. Standby backup is `/opt/qiaomu-apps/qiaomu-rss-dr/standby.pre-latency-20261015.py`; restore and restart only qiaomu-rss-standby if needed. Worker can roll back to the recorded previous version with the same bindings. Keep the deletion gate, sync and fetch services running.

## Verification limits

These measurements are request samples, not a production capacity forecast. Five-minute snapshot scheduling limits how often the 90-second preference window is eligible. The local proxy path still needs its own remedy, coordinated with the website owner. Mobile hardware has not been tested in this server task. Automated regressions cover cache variants, external invalidation, byte limits, gzip negotiation, concurrent readers, stale/pending/wrong-generation snapshots, bounded replica waits and deletion during reads.
