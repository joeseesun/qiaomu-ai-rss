# Reading performance and origin load — 2026-10-11

Scope: local image display/storage, coalesced durable saves, retained list rows, bounded sequential recovery and per-service admission, anonymous primary read cache. No speculative article prefetch. Current production already removes original content from list responses; preserve that contract and measure remaining fields before changing it.

Baseline: 0.27.3 duplicates unresolved reads after 8s and retries HTTP503 after 300ms. New assertions fail against that baseline. A blocked image cache write prevents the downloaded image from displaying; reproducer fails before fix. Local reader checkout has unrelated changes and lags production; do not deploy it wholesale.

Server plan: narrowly scoped, bounded in-process anonymous JSON cache with short TTL, bypass authenticated/unknown queries, invalidate on API mutations and data-file changes. Validate in isolation before mounting on primary. Preserve existing deletion gate and standby. Keep deployment backup and exact rollback command. No production capacity stress test.

## Verification

- 232 Vitest checks, 16 server checks, existing 11 DR checks and 12 Python checks pass; lint/typecheck/production build pass (existing warnings plus the same owner-document DOM creation warning on the new detached staging element).
- Actual desktop QA: 11 performance interaction checks and 12 recovery checks pass. Same 60-row fixture / 100 render calls: installed 0.27.3 rebuilt all rows in 654 ms; optimized run retained all rows in 26 ms (another run 83 ms, so timings are samples, not guarantees). Focus, search, read markers, append and current-entry click callbacks are covered.
- Local and primary-host isolated Express HTTP checks: 100 concurrent identical fixture reads perform one handler evaluation; mutation/file changes invalidate; cookie requests bypass; lean and legacy variants remain separate.
- Primary loopback, same live 100-entry list: before 276,321 bytes and 61–93 ms; lean variant 96,607 bytes (65% smaller), hits 3–6 ms; legacy hits 7–10 ms. IDs/order unchanged. These are small samples, not a capacity test.
- Primary cache deployed with exact-file rollback backups; Worker/deletion gate/standby remain intact. Cache module SHA256: c4ee468e6063a306a1d60558c5bb2134dfa963f29f41eee5c39cbe4717364b8d.
- A local raw public request exceeded the diagnostic deadline. Origin timings do not prove that the user's proxy/TLS/network path is fixed. No speculative prefetch or higher request concurrency was introduced.
