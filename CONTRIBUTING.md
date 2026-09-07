# Contributing

Use feature branches and pull requests. Run `npm ci` then `npm run check`. For changes to the API client, also run the read-only `npm run test:live` against the configured service. Test UI changes in a separate Obsidian vault, including narrow panes, light/dark themes, offline fallback, and repeated note exports.

Keep runtime code independent of Node.js/Electron so mobile support remains possible. Never execute remote scripts, render external Markdown through executable plugin processors, upload vault content, or bundle credentials. Keep network/account/payment disclosures up to date.

For a release, update `package.json`, `package-lock.json`, `manifest.json` and `versions.json` together. Merge a reviewed feature branch, then create the version tag without a `v` prefix and attach `main.js`, `manifest.json`, and `styles.css` to the release. Keep changes and known limits in CHANGELOG.md.
