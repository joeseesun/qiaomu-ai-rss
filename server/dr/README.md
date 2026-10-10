# RSS disaster recovery operations

The primary Reader remains the only writer. Vultr runs a separate standard-library Python service over a public SQLite projection; it has no accounts, AI credentials, schedulers, or signing key. Cloudflare Worker forwards authenticated requests and writes to primary once. Only anonymous public read routes and already cached signed WeChat images can retry standby.

## Deployment

`install.py CONFIG.json` installs either role from a private mode-0600 file containing `role`, `origin`, and primary `control`/`password` or standby `sshPublic`. It deletes the file on success. A systemd ExecStartPre guard remounts deletion middleware after later Reader deploys, and fails startup if the expected insertion point changes. Review production middleware mount before installing; never replace an unrelated Reader checkout. Cloudflare secrets `ORIGIN_KEY` and `CONTROL_KEY` must be provisioned separately. Deploy `wrangler.toml` with authorized account credentials. Never commit the JSON, `.env`, SSH keys or backup password.

The production origin names are deliberately DNS-only to avoid Worker recursion. Both require the origin secret. Only `rss.qiaomu.ai/api/*` and `/media/wechat/*` are Worker routes; static website, private identity and other backend dependencies retain their own availability. The formal hostname must have proxied DNS for Worker routes ([Cloudflare documentation](https://developers.cloudflare.com/workers/configuration/routing/routes/)). TLS certificates renew via certbot HTTP webroot.

Primary service: `qiaomu-rss-sync.timer` starts a sync 300 seconds after the preceding job finishes. Snapshot/export takes approximately 30 seconds before transfer/backup. Hourly encrypted full backup goes to private R2, is downloaded, authenticated, decrypted and SQLite checked before `last-backup.json` is updated. The public replica stores current and previous generation; private R2 retention keeps 24 hours, 14 daily points and eight weekly points. R2 chunks are 48 MiB, below the documented Worker request-body limit ([limits](https://developers.cloudflare.com/workers/platform/limits/)). The backup password also exists on the operator Mac under `~/.config/qiaomu-rss-dr/backup-pass`; keep an independent secure copy for total primary loss.

`capacity-install.sh` installs bounded logs and 15-minute disk/freshness checks. Disk warnings are emitted at 85% or less than 5 GiB free; export refuses below 2 GiB. Checks record systemd failures; no external message destination is configured. A failed sync leaves the previous ready generation in place unless invalidated by a mutation. Failover refuses snapshots older than 24 hours.

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

The destination must not exist. The tool verifies part checksums and encrypt-then-MAC before decrypting, safely extracts and validates the original SQLite. It does not activate a writer. Restored files contain private accounts/configuration: keep them mode-0700. Install matching Node/dependencies from the included lockfile; restore the `code` tree, `dr` implementation and configuration at their documented absolute locations. SSH private key and backup password are deliberately outside the archive. Provision a new restricted sync key if the primary is lost. Production systemd environment paths are evidence for reconstruction, not a portable install script.

Before activating a new writer, isolate the old primary, reconcile accepted writes since the backup, restore images and JSON state, test privately, then change origin routing. Never automatically promote the read-only projection into a writer. Do not restore an old projection and label it with a current revision: it could resurrect deleted data.

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
