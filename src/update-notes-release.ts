import type { UpdateEntry } from './update-notes';

// Prepend a version and user-facing changes for every release. Keep older entries for skipped updates.
export const UPDATE_ENTRIES: UpdateEntry[] = [
  { version: '0.32.6', items: ['introduced', 'revisit', 'control'] },
];
