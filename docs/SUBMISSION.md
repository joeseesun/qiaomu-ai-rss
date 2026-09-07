# Obsidian Community submission

Status: **published** in the [Obsidian Community directory](https://community.obsidian.md/plugins/qiaomu-ai-rss) on 2026-09-07.

## Latest verified review

- 2026-09-07: release 0.18.0, commit `509a3fa9b5acf5b318ef84531ca78c5507c78a88`, completed the official release review. The unauthenticated public listing displays **Review: Passed**, version 0.18.0, and **Add to Obsidian**.
- No errors or warnings are shown for that release. GitHub attestations for main.js/styles.css and byte-for-byte build verification pass. Vault enumeration is disclosed as a recommendation because the plugin offers user-selected local Markdown sources and native file/folder pickers.
- Older releases, including 0.14.0, timed out. Their historical failed reports are not the current release result.
- The new release workflow builds, enforces a 5 MB per-asset budget, attests and publishes assets. Check the latest official review separately after each GitHub release; release publication alone is not proof of directory approval.

The initial-submission workflow below is retained for reference.

The current official workflow uses [community.obsidian.md](https://community.obsidian.md), not a new entry PR to the old `community-plugins.json` list. References checked on 2026-09-07:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)

## Repository and release

- Public repo: `joeseesun/qiaomu-ai-rss`.
- ID: `qiaomu-ai-rss`; display name: `Qiaomu AI RSS`.
- Original plugin implementation. Product/API references are the author's QMReader projects, not a fork of another Obsidian plugin.
- GPL-3.0-only license, source, README, privacy policy and third-party notices are included.
- For each update, the manifest version and release tag must match exactly (without a `v` prefix). Read the current source version from `manifest.json`.
- Release assets: `main.js`, `manifest.json`, `styles.css`.
- The default branch must contain the current manifest before submission.
- Checks: TypeScript, official Obsidian ESLint recommended rules, automated tests, build, public API checks and actual Obsidian UI acceptance. Record limits in VALIDATION.md.

## Submission by the owner

1. Sign in to the Community website with the owner's Obsidian account.
2. Link the GitHub account and add this repository as a plugin.
3. Review its scan results and fix any findings with a new version/release.
4. Complete the listing and choose Publish. Installation through the official directory remains conditional on review acceptance.

The directory requires acceptance of its developer policies and ongoing maintenance commitments. Future releases remain subject to review; a successful local build alone does not establish directory approval.
