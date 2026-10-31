import type { UpdateEntry } from './update-notes';

// Prepend a version and user-facing changes for every release. Keep older entries for skipped updates.
export const UPDATE_ENTRIES: UpdateEntry[] = [
  { version: '0.32.11', items: ['bilingualTitles'] },
  { version: '0.32.10', items: ['networkRecovery'] },
  { version: '0.32.9', items: ['mobileSpeech'] },
  { version: '0.32.8', items: ['mobileToolbar', 'readingPolish'] },
  { version: '0.32.7', items: ['adminMove', 'collectionErrors'] },
  { version: '0.32.6', items: ['introduced', 'revisit', 'control'] },
];
