# Reader speech controls — 0.29.2

The reader toolbar owns an animated narration capsule. Wide readers show play/pause, speed, More and stop; readers at most 650px wide show only play/pause and More, both before and during narration. The compact menu has at most four first-level entries: playback options, sound settings, article actions, and stop while a session exists. Article favorite/read/Daily Note and the original article menu remain reachable. Circular progress around Play represents the current narration range, not elapsed audio time or a seek control.

Wide expansion animates actual width from 32px to 160px over 320ms; the play control travels with the capsule, adjacent article actions and article body stay fixed. Compact narration uses an 80px lane, 32px visible capsule and 40×44px targets. Controls enter in stages; stop releases audio immediately, fades controls/ring and collapses back to the trigger. Reduced-motion preference disables transitions. Custom tips and keyboard focus are retained.

Selection narration carries a cloned DOM Range through toolbar, popup, command and context-menu entry points. Source extraction clips text nodes to that range and maps sentence/word highlights back into those exact nodes. Repeated text elsewhere is never used as an anchor. Browsers lacking the Custom Highlight API do not fall back to highlighting whole paragraphs for selections.

A reported replay regression was reproduced in native Obsidian: the visible selection contained 59 characters but the ended player's queue still contained the previous 14-character excerpt. Play now captures a new selection before focus changes and adopts it when paused/ended. An unchanged selection continues/replays the existing session; changing the selection alone does not start audio. Native regression validation played both sentences (7.146021s and 3.290188s) before completion, and verified clipped highlighting, advancing progress and highlight cleanup.

The settings home has four primary controls: voice, audition, service/model and Done/Start. New users require a completed audition of the current profile before Start. A persisted pending-setup flag prevents closing/reopening a partially configured first-use flow from bypassing the test. Existing configurations are preserved. The service step supports optional Audio import, while cloud credentials, model/voice and local runtime options remain available progressively. Failed configuration preserves input. Opening settings pauses reading; leaving restores its prior paused/playing state and sentence.

Mac discovery uses the pinned shared speech service's native AVSpeechSynthesisVoice enumeration. Quality markers are derived from native quality metadata, then sorted by current language and quality; voice names are not used to invent quality levels. New users prefer installed enhanced/premium voices, with ordinary installed voices still usable. Existing selected voice IDs are retained. The RSS plugin continues to work without Audio installed.

## Verification

- Full `npm run check`: 275 Vitest tests, 31 server checks, i18n round-trip, TypeScript and production build passed. Eight existing lint warnings remain; no lint errors or new dependency changes.
- Native isolated Obsidian 1.14.4 QA: 191 installed Mac voices enumerated; Chinese enhanced voice selected for fresh setup; actual audition played for 3.161396s and completed before unlocking Start.
- Native toolbar/settings assertions cover responsive control counts, exact DOM selection boundaries via pointer events, light/dark and narrow layout bounds, More actions, existing voice preservation and paused playback restoration. Full selected-paragraph replay additionally verified both nonempty audio segments to completion.
- Native QA scripts and screenshots are retained in ignored `artifacts/speech-controls/`; release stages are recorded separately in `artifacts/release-0.29.2/`.
- Word timing for voices without native timing is estimated by the existing shared engine. This change does not promise precise acoustic word alignment. Mobile hardware and paid cloud provider audio were not tested.

## Interactive refinement

The user rejected a reserved blank expansion lane and heavy outlined capsule. The final version uses actual width interpolation, a subtle neutral fill, thinner ring and staged icon transitions. Native frame sampling confirms intermediate widths while article and adjacent-action bounds stay unchanged. Subsequent user feedback reduced compact mode from four controls/200px to two controls/80px. The same menu remains available when idle. The original complete-selection replay regression remains part of acceptance.
