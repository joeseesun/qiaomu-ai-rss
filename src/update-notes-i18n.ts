import { M } from './i18n';
export type UpdateMessage = "title" | "view" | "done" | "automatic" | "saveError" | "introduced" | "revisit" | "control" | "fallback" | "adminMove" | "collectionErrors" | "mobileToolbar" | "readingPolish" | "mobileSpeech" | "networkRecovery" | "bilingualTitles";
export const UPDATE_LOCALES = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de'] as const;
export function updateText(language: string, key: UpdateMessage): string {
  const code = String(language || 'en').toLowerCase();
  const locale = code.startsWith('zh') ? (/tw|hk|mo|hant/.test(code) ? 'zh-TW' : 'zh-CN') : code.split(/[-_]/)[0];
  const index = UPDATE_LOCALES.findIndex(value => value === locale);
  const row = M.find(row => row[0] === 'updates.' + key);
  return row?.[(index < 0 ? 1 : index) + 1] || key;
}
