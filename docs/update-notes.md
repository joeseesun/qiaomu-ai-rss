# Update notes

The plugin bundles offline release notes in `update-notes-release.ts`. For each release, prepend the new manifest version and concise user-facing change keys, with translations in `update-notes-i18n.ts`. Retain earlier entries so users who skip versions can see intervening changes. The locale follows the existing plugin language resolver.

The native Obsidian modal is shown once per installed version, after the workspace is ready. A shared, vault-scoped queue prevents the Qiaomu plugins from stacking their update dialogs or covering another modal. About and the command palette can reopen the notes. Users can disable automatic display in the dialog.

Only `update-notes.json` inside the plugin folder stores seen version and the automatic-display preference. Plugin settings, books, notes, API keys and caches are untouched by this component. Corrupt metadata is preserved and automatic display pauses; the manual entry remains available. Unloading removes pending dialogs and closes any open instance.

Validation: `node scripts/test-update-notes.mjs`, the normal repository checks, and real Obsidian QA. The component has no network requests or desktop-only dependencies. Desktop host coverage and mobile-layout coverage are separate from physical-device verification.

## 0.32.5 validation (2026-10-25)

The normal repository checks and the update-note regression script pass. In Obsidian 1.13.7, the eight candidate plugins loaded together and displayed one update dialog at a time, with focus inside each dialog. Re-enabling all eight produced no repeat dialogs. Every About entry reopened the correct notes, including from the separate Settings window. Light, dark and a 390px window were checked without horizontal overflow. Language fixtures covered English, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian and Arabic (RTL). Opt-out persisted across a simulated upgrade; Escape closed the dialog. These are desktop-host and layout checks, not physical mobile-device tests.
