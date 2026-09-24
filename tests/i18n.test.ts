import { afterEach, describe, expect, it } from 'vitest';
import { setMockLanguage } from 'obsidian';
import { M, dividerLabel, locale, relativeTime, t } from '../src/i18n';

afterEach(() => setMockLanguage('zh'));

describe('i18n tables', () => {
  it('ships all eight translations for every message', () => {
    expect(M.length).toBeGreaterThan(400);
    for (const row of M) {
      expect(row.length, row[0]).toBe(9);
      for (const cell of row) expect(typeof cell === 'string' && cell.length > 0, row[0]).toBe(true);
    }
  });
  it('maps Obsidian languages onto the shipped locales', () => {
    for (const [lang, expected] of [['zh', 'zh-CN'], ['zh-cn', 'zh-CN'], ['zh-tw', 'zh-TW'], ['zh-hk', 'zh-TW'], ['en', 'en'], ['en-gb', 'en'], ['ja', 'ja'], ['ko', 'ko'], ['es', 'es'], ['fr', 'fr'], ['de', 'de'], ['pt', 'en']] as const) {
      setMockLanguage(lang);
      expect(locale(), lang).toBe(expected);
    }
  });
  it('translates and fills placeholders in the active locale', () => {
    setMockLanguage('en');
    expect(t('notice.appendedToNote', { name: 'Daily' })).toBe('Appended to Daily');
    setMockLanguage('fr');
    expect(t('common.cancel')).toBe('Annuler');
    setMockLanguage('zh');
    expect(t('notice.appendedToNote', { name: '日记' })).toBe('已追加到 日记');
  });
  it('localizes the API relative dates', () => {
    expect(relativeTime('over 3 days ago')).toBe('3 天多前');
    expect(relativeTime('yesterday')).toBe('昨天');
    setMockLanguage('en');
    expect(relativeTime('over 3 days ago')).toBe('over 3 days ago');
    setMockLanguage('ja');
    expect(relativeTime('2 weeks ago')).toBe('2週間前');
  });
  it('localizes curated channel dividers and keeps custom ones', () => {
    expect(dividerLabel('微信公众号')).toBe('微信公众号');
    setMockLanguage('en');
    expect(dividerLabel('微信公众号')).toBe('WeChat accounts');
    expect(dividerLabel('我的分组')).toBe('我的分组');
  });
});
