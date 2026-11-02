import { describe, expect, it } from 'vitest';
import { initialState } from './model';
import { mobileSpeechSettings } from './speech-platform';

describe('RSS speech platform selection', () => {
  it('uses device speech on mobile even after schema supplies the desktop default', () => {
    const settings = initialState({}).settings.tts;
    expect(mobileSpeechSettings(settings, false).provider).toBe('system');
    expect(mobileSpeechSettings(settings, true).provider).toBe('edge');
  });

  it('makes synced or imported Edge settings playable without losing saved voices or speed', () => {
    const saved = { provider: 'edge', profiles: { edge: { voice: 'zh-CN-XiaoxiaoNeural' }, system: { voice: 'device-voice' } }, rate: 1.25, welcomed: true };
    const result = mobileSpeechSettings(saved, false);
    expect(result).toEqual({ ...saved, provider: 'system' });
    expect(saved.provider).toBe('edge');
    expect(mobileSpeechSettings(saved, true)).toBe(saved);
    expect(mobileSpeechSettings(result, false)).toBe(result);
  });

  it.each(['system', 'doubao', 'azure', 'qwen', 'compatible'])('keeps an explicitly configured %s service', provider => {
    const saved = { provider, profiles: { [provider]: { voice: 'saved-voice' } }, rate: 1, welcomed: true };
    expect(mobileSpeechSettings(saved, false)).toBe(saved);
  });
});
