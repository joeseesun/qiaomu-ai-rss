# Admin collection and article organization

Updated: 2026-10-26 (Asia/Shanghai).

Scope: fix the Goodfire collection failure, support every public channel plus private subscription groups (both confirmed by the user). Preserve article identity, content, AI results, favorites and reading state. No WeChat UI automation.

Baseline: origin/main 627f657 (0.32.6), isolated worktree rss-admin-move-fix. The old 0.29.0 checkout was not used for installation.

Evidence:
- Original job b2a2cb17-699a-4a30-88d1-54729eae7120 passed authentication/fetch but failed translation: a 10376-character structured block exceeded the 10000-character request budget.
- Actual Goodfire DOM: 417 blocks split into 420, preserving all text, 313 images and 176 links; largest prompt block 9847 characters.
- A linked author byline was incorrectly treated as untranslated prose. Generic bounded byline recognition now distinguishes it from ordinary headings/body text.
- Translation checkpoints preserve validated blocks across failure/restart; input and provider/model changes invalidate reuse. At most two concurrent chunks. Incomplete articles are never saved as complete.
- Latest production task 64dbf47f-045b-4127-a2e1-4778abaead2f is running. Full real-article completion remains pending.
- Production backup: /opt/qiaomu-apps/qmreader/.deploy-backups/rss-admin-tools-1792986288023988481. Narrow idempotent patches apply to the current live baseline, not an old server checkout.
- 318 plugin tests, 37 server tests, 3 language bundle checks passed; lint zero errors and 10 existing warnings. Build/typecheck and release artifact audit passed. npm audit reported zero known vulnerabilities.
- Isolated native Obsidian: 137 public channels selectable; actual move/search/read/restore preserved original content and rewrite. Private move/search/read/plugin-reload preserved content and public source. Group merging/deletion and scoped storage tested. No admin token saved in the QA vault.
- Narrow dialog inspected visually with current rendered frames. Public/private effect is explained before confirming. No physical mobile-device test.
- rockfish received initial 0.32.7; final private-group build installation pending. Existing data was preserved during asset replacement.
- PR #95. Official preview b09cbea completed with existing warnings only. Expanded final candidate requires another preview. Public Release and default-branch version update remain pending.
