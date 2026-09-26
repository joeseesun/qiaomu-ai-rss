import { vi } from 'vitest';
export const requestUrl = vi.fn();
let mockLanguage = 'zh';
export const getLanguage = () => mockLanguage;
export const setMockLanguage = (value: string) => { mockLanguage = value; };
export const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '') || '/';
export const moment = () => ({ format: (format: string) => format === 'YYYY-MM-DD' ? '2026-09-07' : format });
export const setIcon = vi.fn();
export class TFolder { constructor(public path: string) {} }
