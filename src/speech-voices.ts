import type { VoiceChoice } from '@qiaomu/speech/speech';
// These markers come from the native AVSpeechSynthesisVoice.quality metadata,
// not from a guessed voice name. Keep the shared catalog's stable voice IDs.
export const voiceMarker = (key: string) => `[[${key}]]`;
export function preferredMacVoices(voices: VoiceChoice[], language: string, translate: (key: string) => string): VoiceChoice[] {
  const parts = (voice: VoiceChoice) => voice.label.split(' · ');
  const languageScore = (voice: VoiceChoice) => {
    const lang = parts(voice)[1]?.toLowerCase() || '', wanted = language.toLowerCase();
    return lang === wanted ? 2 : lang.split('-')[0] === wanted.split('-')[0] ? 1 : 0;
  };
  const quality = (voice: VoiceChoice) => parts(voice).includes(voiceMarker('voicePremium')) ? 3 : parts(voice).includes(voiceMarker('voiceEnhanced')) ? 2 : 1;
  return [...voices].sort((a, b) => languageScore(b) - languageScore(a) || quality(b) - quality(a))
    .map(voice => {
      const display = voice as VoiceChoice & { sourceName?: string };
      const localize = (text: string) => text.replace(/\[\[(\w+)\]\]/g, (_, key: string) => translate(key));
      return { ...voice, label: localize(voice.label), ...(display.sourceName ? { sourceName: localize(display.sourceName) } : {}) };
    });
}
