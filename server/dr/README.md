# RSS disaster recovery operations

The primary Reader remains the only writer. Vultr runs a separate standard-library Python service over a public SQLite projection; it has no accounts, AI credentials, schedulers, or signing key. Cloudflare Worker forwards authenticated requests and writes to primary once. Only anonymous public read routes and already cached signed WeChat images can retry standby.

## Deployment

`install.py CONFIG.json` installs either role from a private mode-0600 file containing `role`, `origin`, and primary `control`/`password` or standby `sshPublic`. It deletes the file on success. A systemd ExecStartPre guard remounts deletion middleware after later Reader deploys, and fails startup if the expected insertion point changes. Review production middleware mount before installing; never replace an unrelated Reader checkout. Cloudflare secrets `ORIGIN_KEY` and `CONTROL_KEY` must be provisioned separately. Deploy `wrangler.toml` with authorized account credentials. Never commit the JSON, `.env`, SSH keys or backup password.

The production origin names are deliberately DNS-only to avoid Worker recursion. Both require the origin secret. Only `rss.qiaomu.ai/api/*` and `/media/wechat/*` are Worker routes; static website, private identity and other backend dependencies retain their own availability. The formal hostname must have proxied DNS for Worker routes ([Cloudflare documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/)). TLS certificates renew via certbot HTTP webroot.

Primary service: `qiaomu-rss-sync.timer` starts a sync 300 seconds after the preceding job finishes. Hourly encrypted full backup runs before public export, so an export timeout cannot suppress the private backup. It goes to private R2 and is downloaded, authenticated, decrypted and SQLite checked before `last-backup.json` is updated. The public export uses page-sized hydration with Reader 1.0.14 or newer and retains compatibility with older Readers; its 600-second budget remains bounded. The public replica stores current and previous generation; private R2 retention keeps 24 hours, 14 daily points and eight weekly points. R2 chunks are 48 MiB, below the documented Worker request-body limit ([limits](https://developers.cloudflare.com/workers/platform/limits/)). The backup password also exists on the operator Mac under `~/.config/qiaomu-rss-dr/backup-pass`; keep an independent secure copy for total primary loss.

`capacity-install.sh` installs bounded logs and 15-minute disk/freshness checks. Disk warnings are emitted at 85% or less than 5 GiB free; export refuses below 2 GiB. Checks record systemd failures; no external message destination is configured. A failed sync leaves the previous ready generation in place unless invalidated by a mutation. Failover refuses snapshots older than 24 hours.

Private archives use gzip level 1 to reduce CPU contention with live reading. A bounded 32 MiB source-data sample used about 69% less CPU than level 9, with an 18% larger compressed result; whole-backup ratios vary. Encryption, part checksums, HMAC verification and the download/decrypt/SQLite restore check remain mandatory. A corrupt downloaded part must leave the successful-backup marker unchanged.

## Validation and fault drills

```
node --test server/dr/*.check.*
python3 -m unittest discover -s server/dr -p 'test_*.py'
```

On primary: `python3 /opt/qiaomu-apps/qiaomu-rss-dr/verify.py` compares production APIs against the real standby, exercises authenticated preview-only 500/timeout/invalid-JSON drills, and runs concurrent reads. It changes no articles and does not stop the primary. Drills require control authorization and are forbidden on the formal hostname. The replica itself receives real HTTPS requests in each drill.

Control API `https://rss-dr.qiaomu.ai/__dr/status` requires `Authorization: Bearer CONTROL_KEY`. Inspect revision, ready, snapshot time and pending tickets. Do not print credentials in shell logs. `/__dr/backups` lists backup objects; GET `/__dr/backup/hourly/<snapshot>/manifest.json` returns metadata.

## Restore into isolation

Load the private primary environment and point `RSS_DR_BACKUP_PASSWORD_FILE` to the escrowed password. Run:

```
python3 restore.py hourly/<snapshot>/manifest.json /new/isolated/directory
```

The destination must not exist. The tool verifies part checksums and encrypt-then-MAC before decrypting, safely extracts and validates the original SQLite. It does not activate a writer. Restored files contain private accounts/configuration: keep them mode-0700. Install matching Node/dependencies from the included lockfile; restore the `code` tree, `dr` implementation and configuration at their documented absolute locations. New backups also include `external-state/qmreader-{podcast,podscribe,youtube}-notes`; restore these private archives to their configured `QMREADER_*_NOTES_DIR` paths with the service's ownership and permissions. Interrupted `.tmp` and `.lock` files are excluded. These archives are never added to the public projection. SSH private key and backup password are deliberately outside the archive. Provision a new restricted sync key if the primary is lost. Production systemd environment paths are evidence for reconstruction, not a portable install script.

Before activating a new writer, isolate the old primary, reconcile accepted writes since the backup, restore images and JSON state, test privately, then change origin routing. Never automatically promote the read-only projection into a writer. Do not restore an old projection and label it with a current revision: it could resurrect deleted data.

## Snapshot time budget

Public export has a finite 600-second budget. The sync service allows 1500 seconds for private backup verification, export, and atomic network publication together. Existing installations must update their systemd timeout as well as `snapshot.py`. The lock and five-minute-after-completion timer prevent overlapping runs. A timeout never writes a successful public-sync marker; private backups retain their independent restore-verification marker.

## Deletion coordination

Before DELETE, admin mutations and source visibility changes, primary middleware starts a durable ticket and increments revision. Standby is invalidated immediately. After successful HTTP completion the ticket ends, but standby remains blocked until a fresh snapshot is atomically promoted and published at the new revision. An aborted request, >=500 result, or coordinator failure deliberately leaves a pending ticket. Investigate the production result and content visibility, then explicitly finish the known ticket through the protected API and run a new sync. Never clear pending blindly. Coordinator outage rejects these mutations with 503, preserving the deletion guarantee.

## Routing rollback

Remove only this Worker's two formal routes, then restore the recorded `rss.qiaomu.ai` DNS record to the primary DNS-only address. Keep the control preview, services and deletion middleware alive until a controlled middleware removal. DNS-only clients may continue using origin until their DNS cache expires; rollback is not instantaneous. The unmodified Reader `server.js` is backed up under `.deploy-backups/rss-dr-20261006/` on primary. Do not overwrite subsequent application changes from that file wholesale.

## Primary public read cache (2026-10-11)

`ensure-gate.py` optionally mounts `public-read-cache.cjs` when that module is present beside it. Place the module from `server/public-read-cache.cjs` there only after validation. The cache is installed after compression/security headers and before session lookup. It does not replace the deletion gate, Worker, standby, or authentication. The data stamp includes the configured SQLite file and WAL; requests observe data changes without waiting for TTL. Authenticated reads always reach existing handlers.

Validate unit and HTTP integration separately (HTTP integration uses the backend's installed Express, with no new plugin dependency):

```
node --test server/public-read-cache.check.cjs
QMREADER_MODULES=/path/to/qmreader node --test server/dr/public-read-cache-http.integration.cjs
```

Before mounting, back up the current `server.js`, `ensure-gate.py` and any existing cache module. Syntax-check, restart only qmreader, and verify anonymous list/detail routes, compact/legacy variants, authentication bypass and existing standby checks. Roll back by restoring those exact files and removing the new module only if none existed previously, then restart qmreader. Restoring `server.js` alone is insufficient because ExecStartPre remounts the middleware. Never use an old full checkout to overwrite later production edits.

## Prepared lists and replica preference (2026-10-15)

Some newer QMReader handlers call `sendCached(...).end()` directly, bypassing the older `res.json` public-cache interception. Install `server/response-cache.cjs` as the website's `lib/response-cache.js`, and integrate `server/patch-prepared-list.py` with the exact deployed `server.js` after reviewing its guarded replacements. The patch is deliberately not a general deployment script: all expected insertion points must match, it refuses reapplication, and it preserves unrelated production changes. Website source should own the integrated module in its next release.

`X-Rss-List: reader-v1` selects compact metadata for the plugin; cache keys, Vary and validators distinguish this from legacy responses. The prepared cache has a 32 MiB estimated memory budget and observes JSON/SQLite/WAL changes, so external deletions do not wait for TTL. An invalidated asynchronous fill cannot repopulate the cache. Shared HTTP responses use `no-store`; prepared JSON/gzip is cached inside the process. Cookie/authorization handling stays with existing application routes. Do not equate this header with the website's separate `summary=minimal` query protocol.

`READ_REPLICA_CONTINENTS=AS,OC` allows anonymous compact GET lists to prefer the read-only standby when the deletion gate is ready and the snapshot is no more than 90 seconds old. Gate, body transfer and the second gate check share a 1.2-second preference budget. A stale, unavailable, mismatched or invalidated replica falls back to primary. Cookie/authorization requests, writes and explicit HTTP `Cache-Control: no-cache`, `no-store`, `max-age=0` or `Pragma: no-cache` bypass preference. This is a header contract; it does not imply that every client refresh button sends these headers. The existing five-minute-after-completion sync cadence means preference is intermittent. Do not advertise continuous load balancing or zero-lag replicas. Existing outage fallback retains its 24-hour snapshot age bound and deletion gate.

Standby compresses responses only when gzip is accepted and removes heavyweight fields only for compact list responses; article details retain their content. Observe `X-Rss-Origin`, `X-Rss-Route` and `X-Rss-Replica-Age` to distinguish actual replica hits from primary reads. Test routes from multiple networks: a local Fake-IP/TUN proxy timeout can coexist with a healthy origin and edge.

Additional validation:

```
node --test server/response-cache.check.cjs server/dr/worker.check.mjs
QMREADER_MODULES=/path/to/qmreader node --test server/prepared-list-http.integration.cjs
```

`verify.py --allow-view-counter-drift` ignores only the detail's view count, last-view timestamp and statistics update timestamp. It still fails on any list/order/content difference. Ongoing ingestion can legitimately make a live origin newer than the exported snapshot; investigate the added IDs and timestamps instead of declaring strict parity or weakening assertions silently.

## Incremental public generation

With Reader 1.0.14 or newer, only new or changed entries are hydrated. Unchanged rows are copied from the previously published projection inside SQLite. The input fingerprints track source rows, Chinese rewrites/translations, contributions, statistics, reactions (including indirect comment/chat/annotation references), queue status, cached original bodies, and the entry's private transcript files. Images are reconciled separately so arriving or evicted image bytes do not require article hydration. Disabled sources and deleted articles are omitted from the new generation. Raw input scanning and consistent database capture still run each time; this is not a database change-log protocol or zero-work sync.

Fingerprints stay private under the primary's mode-0700 work directory. `projection-current` atomically pairs `public.sqlite` with `state.json`, and advances only after promotion and deletion-gate publication succeed. Failed exports/publications keep the last accepted cache for retry. Missing, corrupt or mismatched cache, schema/code/environment changes, and the daily full reconciliation trigger a full rebuild. `RSS_DR_FORCE_FULL=1` also forces a full rebuild. Each run logs generated/reused/deleted counts. Deploy `incremental.cjs` together with `export.cjs` and `snapshot.py`.

The anonymous projection currently does not read sessions, OAuth accounts, API tokens, notifications, follows, submission requests, or refresh job records. These tables are excluded from invalidation; review this list if projection dependencies change. All other tables with `entry_id` are tracked per article, and unknown tables without an article key conservatively invalidate all rows. Private hourly backups remain complete, encrypted and restore-tested.

## Independent backups and shadow replicas

Set `RSS_DR_SKIP_BACKUP=1` on the public publication job. Run a separate job with `RSS_DR_BACKUP_ONLY=1` and `RSS_DR_SKIP_BACKUP=0`; give that job its own EnvironmentFile so an inherited file cannot override the intended flags. The jobs use separate locks. Private backups consistently capture the Reader, AI-spend and co-located Podscribe SQLite databases, external notes, service environment files and GetNote configuration, then download, authenticate, decrypt and integrity-check the restored databases. `RSS_DR_BACKUP_KEY_ID` labels password rotations; retain previous password files privately for historical restores.

`RSS_DR_NODE` selects the trusted Node executable. `RSS_DR_EXTRA_TARGETS` is a JSON list of additional restricted `rss-sync@host` receivers. One public projection is transferred independently to each target and results are written to `replicas.json`. The existing router still serves only `RSS_DR_SSH_TARGET`; additional targets are shadow copies until a router validates each replica's snapshot, revision and freshness. A failed routed target prevents publication even if a shadow target succeeds.

Read-only detail responses include the article/rewrite bundle expected by current readers. Missing snapshot assets return settled `unavailable` state with no polling delay; a snapshot never claims a live AI generation job. Verification compares published content separately from this intentional read-only availability policy.

Private backup downloads read in bounded chunks, retry transient GET failures, and stop each encrypted part at its manifest length. This avoids waiting indefinitely for connection closure and limits responses that keep trickling bytes. SHA256, HMAC, decryption and restored-database checks still run before success is recorded.
