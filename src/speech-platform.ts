import type { SpeechSettings } from '@qiaomu/speech/speech';

// Edge's shared adapter uses Node WebSocket and cannot run on Obsidian mobile.
// Keep saved voice profiles so a desktop selection is still available later.
export function mobileSpeechSettings(settings: SpeechSettings, desktop: boolean): SpeechSettings {
  return !desktop && settings.provider === 'edge' ? { ...settings, provider: 'system' } : settings;
}
