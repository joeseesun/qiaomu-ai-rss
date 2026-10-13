import { describe, expect, it } from 'vitest';
import { contrastRatio, DEFAULT_HIGHLIGHT, highlightPalette } from '../src/speech-highlight';
import { initialState } from '../src/model';

describe('read-along appearance', () => {
  it.each([
    ['#ffffff', '#292929'], ['#f8f5ee', '#2e2a24'], ['#edf2ec', '#27322c'],
    ['#f3f5f8', '#1f2933'], ['#171c24', '#d5dce6'], ['#000000', '#c8c8c8'], ['#888888', '#888888'],
  ])('keeps custom colors readable on %s', (surface, ink) => {
    for (const color of ['#ffffff', '#000000', '#ffff00', '#0000ff', '#ff0000', '#e0a400']) {
      const palette = highlightPalette(color, surface, ink);
      expect(contrastRatio(palette.ink, palette.sentence)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.ink, palette.word)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.line, surface)).toBeGreaterThanOrEqual(3);
    }
  });
  it('upgrades old settings without losing progress or speech preferences', () => {
    const previous = { settings: { tts: { provider: 'macos', profiles: { macos: { voice: 'kept' } }, rate: 1.25, welcomed: true } }, readIds: ['kept'], speechProgress: { entry: { fingerprint: 'abc', offset: 42, ended: false, at: 12 } } };
    const next = initialState(previous);
    expect(next.settings.speechHighlight).toEqual(DEFAULT_HIGHLIGHT);
    expect(next.settings.tts).toEqual(previous.settings.tts);
    expect(next.speechProgress).toEqual(previous.speechProgress);
    expect(next.readIds).toEqual(previous.readIds);
  });
  it.each(['background', 'underline', 'sentence'])('retains %s and a color through reload', style => {
    const state = initialState({ settings: { speechHighlight: { style, color: '#11aAbB' } } });
    expect(initialState(JSON.parse(JSON.stringify(state))).settings.speechHighlight).toEqual({ style, color: '#11aAbB' });
  });
  it('recovers malformed appearance without losing reading data', () => {
    for (const speechHighlight of [null, 'bad', { style: 'future', color: 'url(bad)' }]) {
      const state = initialState({ settings: { speechHighlight }, readIds: ['kept'] });
      expect(state.settings.speechHighlight).toEqual(DEFAULT_HIGHLIGHT);
      expect(state.readIds).toEqual(['kept']);
    }
  });
});
