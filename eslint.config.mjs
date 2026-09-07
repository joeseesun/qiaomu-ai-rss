import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
export default defineConfig([
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } },
    rules: { 'obsidianmd/ui/sentence-case': ['warn', { enforceCamelCaseLower: true, ignoreWords: ['Atom', 'MB'], brands: ['OPML', 'RSSHub'] }] } },
]);
