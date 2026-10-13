# macOS Obsidian acceptance, 2026-10-13

Independent vault `qiaomu-audio-qa`, Obsidian 1.14.4, macOS. No production vault settings or keys were used in this run.

- ASR draft setup: 11 real UI assertions. Add opens a modal; opening, choosing a provider and closing never alter saved settings. Required missing key prevents commit with visible feedback. Confirm adds only the chosen provider; repeating the same configuration selects it without duplication. Key application links are present.
- Audio/RSS model and voice linkage: 139 real host assertions across the curated model list in both consumers. Each model selection changes its persisted model/resource and selects an applicable voice. Native catalog discovery in both consumers lists enhanced voices automatically. The Linfei system identifier was used for real playback, independently in each consumer.
- RSS full reading: actual original/rewrite content; pause in either direction retains the sentence; one paragraph highlighted; independent mode progress; returning to original restores offset; selected text does not change full-body progress; RSS runs with Audio disabled. Audio also runs with RSS disabled.
- Saving RSS state twice retains the same speech service. This guards the integration failure where persistence recreated the controller.
- Both consumers resolve the same application-data model directory. No model download was initiated; existing shared data remains untouched.

Cloud adapter tests use fixture responses and do not establish a paid account connection. Windows/Linux CI covers code and protocols, not device playback. Mobile device playback is not claimed. Local runtime/model downloads were not repeated in this host run.

Additional final acceptance: toolbar voice pickers open on a real click and provide direct provider/model selection. RSS header icon matches adjacent icon styling when idle and emphasizes only actual playback; pause clears it. A translated fixture was spoken in English; audition restored the exact owner, sentence and rate paused. The final consumer dependency is pinned to Audio commit e2781672bf49899d727fea7138bdcbe53682aa5e, and `npm ci` plus the complete RSS checks passed from that immutable source.
