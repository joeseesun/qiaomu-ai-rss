import { describe, expect, it } from 'vitest';
import { preferredMacVoices, voiceMarker } from './speech-voices';
describe('native Mac voice preference', () => {
  it('prefers language then native quality, preserving voice IDs and input order', () => {
    const voices = [
      { id: 'normal', label: 'Premium in name · zh-CN' },
      { id: 'english', label: `English · en-US · ${voiceMarker('voicePremium')}` },
      { id: 'enhanced', label: `Chinese · zh-CN · ${voiceMarker('voiceEnhanced')}` },
      { id: 'premium', label: `Chinese · zh-CN · ${voiceMarker('voicePremium')}` },
    ];
    const result = preferredMacVoices(voices, 'zh-CN', key => key === 'voicePremium' ? '高品质' : '增强');
    expect(result.map(v => v.id)).toEqual(['premium', 'enhanced', 'normal', 'english']);
    expect(result[0].label).toBe('Chinese · zh-CN · 高品质');
    expect(voices[0].id).toBe('normal');
  });
  it('keeps normal voices usable and never invents enhanced quality from a name', () => {
    expect(preferredMacVoices([{id:'a',label:'Enhanced · zh-CN'}], 'zh-CN', key => key)).toEqual([{id:'a',label:'Enhanced · zh-CN'}]);
  });
});
