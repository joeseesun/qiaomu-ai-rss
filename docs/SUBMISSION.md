# Obsidian Community submission

Status: **published** in the [Obsidian Community directory](https://community.obsidian.md/plugins/qiaomu-ai-rss) on 2026-09-07.

## Publication evidence

- Version 0.3.0, reviewed commit `00f2d0ae75f3411ef2a4ae41c48198e99137cdb0`.
- Automated review completed. Dependency scan passed; the reviewer reproduced release `main.js` byte-for-byte from source. Vault-write behavior passed.
- Non-blocking feedback: CSS `text-decoration` partial compatibility with Obsidian 1.11.4 (the plugin requires 1.13.0), use of `!important`, and a recommendation to add GitHub artifact attestations for `main.js` and `styles.css`.
- The public page and its `obsidian://show-plugin?id=qiaomu-ai-rss` installation link were verified both in the browser and with an unauthenticated HTTP request.
- Listing includes an RSS icon, English descriptions, three actual desktop screenshots, free pricing, and Research / Import / Integrations categories.
- Listing owner: 向阳乔木 (`vista8`); source repository: `joeseesun/qiaomu-ai-rss`.

The initial-submission workflow below is retained for reference.

The current official workflow uses [community.obsidian.md](https://community.obsidian.md), not a new entry PR to the old `community-plugins.json` list. References checked on 2026-09-07:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)

## Repository and release

- Public repo: `joeseesun/qiaomu-ai-rss`.
- ID: `qiaomu-ai-rss`; display name: `Qiaomu AI RSS`.
- Original plugin implementation. Product/API references are the author's QMReader projects, not a fork of another Obsidian plugin.
- MIT license, source, README, privacy policy and third-party notices are included.
- For each update, the manifest version and release tag must match exactly (without a `v` prefix). The current source version is `0.9.1`.
- Release assets: `main.js`, `manifest.json`, `styles.css`.
- The default branch must contain the current manifest before submission.
- Checks: TypeScript, official Obsidian ESLint recommended rules, automated tests, build, public API checks and actual Obsidian UI acceptance. Record limits in VALIDATION.md.

## Submission by the owner

1. Sign in to the Community website with the owner's Obsidian account.
2. Link the GitHub account and add this repository as a plugin.
3. Review its scan results and fix any findings with a new version/release.
4. Complete the listing and choose Publish. Installation through the official directory remains conditional on review acceptance.

The directory requires acceptance of its developer policies and ongoing maintenance commitments. Future releases remain subject to review; a successful local build alone does not establish directory approval.
