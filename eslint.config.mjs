import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
export default defineConfig([
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
]);
