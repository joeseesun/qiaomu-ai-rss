# Speech interaction acceptance: 0.28.1

2026-10-13, isolated macOS Obsidian 1.14.4.

- Project lint, tests, typecheck and production build passed; production dependency audit reported no vulnerabilities.
- Host checks measured a 16 CSS-pixel service/search gap in the shared voice picker, verified picker controls at 300/360 CSS pixels and nine speech configuration forms with advanced settings at 300 CSS pixels.
- Speech is bundled independently using an exact Qiaomu Audio source commit. No Audio plugin installation is required.
- Mobile hardware and paid cloud playback remain unverified; narrow layout checks were simulated on desktop.
