#!/usr/bin/env python3
"""Apply narrow, idempotent patches to the live QMReader baseline; never replace it."""
import argparse, shutil, subprocess, time
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('--root',required=True); args=p.parse_args()
r=Path(args.root).resolve(); src=Path(__file__).resolve().parent
files=['lib/fetcher.js','lib/deepseek.js','server.js']
original={f:(r/f).read_text() for f in files}; updated=dict(original)
def replace(f, old, new, marker):
    if marker in updated[f]: return
    if updated[f].count(old)!=1: raise RuntimeError('Unexpected baseline: '+f+' '+marker)
    updated[f]=updated[f].replace(old,new,1)
replace('lib/deepseek.js','  return blocks;\n}\n\nfunction translationPromptBlock',"  return require('./translation-blocks.cjs').splitTranslationBlocks(blocks, { cheerio, stripHtml, maxChars: TRANSLATION_SINGLE_BLOCK_MAX_CHARS });\n}\n\nfunction translationPromptBlock", "require('./translation-blocks.cjs')")
replace('lib/deepseek.js', "(isLikelyEnglish(block.source) && !/[\\u3400-\\u9fff]/.test(target))", "(isLikelyEnglish(block.source) && !/[\\u3400-\\u9fff]/.test(target) && !require('./translation-blocks.cjs').preservesAttribution(block, target))", '.preservesAttribution(block, target)')
replace('lib/fetcher.js','function decorateEntry(entry) {',"function decorateEntry(entry) {\n  entry = require('./entry-placement.cjs').placement(getSourceById).decorate(entry);", "placement(getSourceById).decorate")
replace('lib/fetcher.js', "function decorateEntry(entry) {\n  entry = require('./entry-placement.cjs').placement(getSourceById).decorate(entry);", "function decorateEntry(entry) {\n  return require('./entry-placement.cjs').placement(getSourceById).decorate(decorateOriginalEntry(entry));\n}\n\nfunction decorateOriginalEntry(entry) {", 'function decorateOriginalEntry(entry)')
replace('lib/fetcher.js','  const uniqueEntries = new Map();',"""  // Include moved articles even when their original feed was filtered out.
  for (const id of require('./entry-placement.cjs').placement(getSourceById).entries()) {
    const entry = store.getEntry(id);
    if (entry && !store.isEntryDeleted(id)) all.push(decorateEntry(entry));
  }
  all = all.filter(entry => {
    const source = byId[entry.sourceId];
    return source && isEnabled(source) && (!sourceId || source.id === sourceId) && (!category || source.category === category)
      && (!source.separate || source.id === sourceId || source.category === category)
      && (!allowedOptInSourceIds || !source.optIn || source.id === sourceId || allowedOptInSourceIds.has(source.id));
  });
  const uniqueEntries = new Map();""",'Include moved articles even')
replace('server.js',"require('./lib/lab-moderation').mountLabModeration(app, { store, deleteEntry: fetcher.deleteEntry });", """require('./lib/lab-moderation').mountLabModeration(app, {
  store, deleteEntry: fetcher.deleteEntry, getSources: fetcher.getSourcesMeta,
  moveEntry: (id, sourceId, userId) => {
    const result = require('./lib/entry-placement.cjs').placement(fetcher.getSourceById).move(id, sourceId, userId);
    publicApiCache.clear(); return result;
  },
});""", 'moveEntry: (id, sourceId, userId)')
copies={'lib/translation-blocks.cjs':src/'translation-blocks.cjs','lib/entry-placement.cjs':src/'entry-placement.cjs','lib/lab-moderation.js':src.parent/'lab-moderation.js','lib/lab-collection.js':src.parent/'lab-collection.js'}
for content in updated.values(): subprocess.run(['node','--check','--input-type=commonjs'],input=content,text=True,check=True)
for f in copies.values(): subprocess.run(['node','--check',str(f)],check=True)
backup=r/'.deploy-backups'/('rss-admin-tools-'+str(time.time_ns())); backup.mkdir(parents=True)
for f in [*files,*copies]:
    if (r/f).exists():
        (backup/f).parent.mkdir(parents=True,exist_ok=True); shutil.copy2(r/f,backup/f)
for f,v in updated.items():
    temp=(r/f).with_suffix('.admin-tmp');temp.write_text(v);temp.replace(r/f)
for f,v in copies.items():
    temp=(r/f).with_suffix('.admin-tmp');shutil.copy2(v,temp);temp.replace(r/f)
print('Backup:',backup)
