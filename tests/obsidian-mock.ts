import { vi } from 'vitest';
export const requestUrl = vi.fn();
export const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '') || '/';
export const moment = () => ({ format: (format: string) => format === 'YYYY-MM-DD' ? '2026-09-07' : format });
