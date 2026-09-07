# Obsidian Community submission

Status: release prepared for directory submission; **not submitted or approved**.

The current official workflow uses [community.obsidian.md](https://community.obsidian.md), not a new entry PR to the old `community-plugins.json` list. References checked on 2026-09-07:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)

## Repository and release

- Public repo: `joeseesun/qiaomu-ai-rss`.
- ID: `qiaomu-ai-rss`; display name: `Qiaomu AI RSS`.
- Original plugin implementation. Product/API references are the author's QMReader projects, not a fork of another Obsidian plugin.
- MIT license, source, README, privacy policy and third-party notices are included.
- The manifest version and release tag must both be `0.3.0` (without `v`).
- Release assets: `main.js`, `manifest.json`, `styles.css`.
- The default branch must contain the current manifest before submission.
- Checks: TypeScript, official Obsidian ESLint recommended rules, automated tests, build, public API checks and actual Obsidian UI acceptance. Record limits in VALIDATION.md.

## Submission by the owner

1. Sign in to the Community website with the owner's Obsidian account.
2. Link the GitHub account and add this repository as a plugin.
3. Review its scan results and fix any findings with a new version/release.
4. Complete the listing and choose Publish. Installation through the official directory remains conditional on review acceptance.

The owner must accept the directory's maintenance/policy commitments and any account agreements personally. No official approval is implied by passing local lint or producing a release.
