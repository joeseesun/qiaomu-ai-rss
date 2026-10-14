#!/usr/bin/env python3
"""Patch the existing Reader in place, preserving other production changes and data."""
import argparse, shutil, subprocess, time
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
source = Path(__file__).resolve().parent
files = ['server.js', 'lib/background-jobs.js', 'lib/fetcher.js', 'public/app.js', 'public/index.html']
original = {name: (root / name).read_text() for name in files}
modified = dict(original)
def replace(name, old, new):
    if new in modified[name]: return
    if modified[name].count(old) != 1: raise RuntimeError('Installation point changed: ' + name + ' / ' + old[:80])
    modified[name] = modified[name].replace(old, new, 1)
replace('lib/background-jobs.js', "const fetcher = require('./fetcher');", "const fetcher = require('./fetcher');\nrequire('../.rss-reliability/bounded-fetch.cjs').install(fetcher);")
replace('lib/fetcher.js', 'const result = await fetchSource(source);', 'const result = await module.exports.fetchSource(source);')
remote = '''
// RSS reliability: remote computation never controls canonical deletion or permissions.
module.exports.acceptRemoteResult = function(source, result) {
  loadDisk({ upsert: false });
  const entries = require('../.rss-reliability/remote-result.cjs').validate(source, result);
  if (!isEnabled(source)) throw new Error('source_disabled');
  const deleted = store.getDeletedEntryIds();
  const accepted = entries.filter(entry => !deleted.has(entry.id));
  const previous = cache[source.id];
  if (previous && previous.fetchedAt > result.fetchedAt) return { ...previous, changedEntries: [] };
  const finalized = finalizeFetchedSource(source, accepted, { feedUrl: result.feedUrl, feedTitle: source.name });
  cache[source.id].fetchedAt = result.fetchedAt;
  cache[source.id].fetchOrigin = 'standby';
  markCacheSourceChanged(source.id); flushDisk();
  return { ...finalized, fetchedAt: result.fetchedAt, fetchOrigin: 'standby' };
};
'''
if '// RSS reliability: remote computation' not in modified['lib/fetcher.js']: modified['lib/fetcher.js'] += remote
replace('server.js', '  refreshWorker = worker;', "  refreshWorker = worker;\n  require('./.rss-reliability/watchdog.cjs').watch(worker);")
replace('server.js', "    finishFetchJob({ result: workerResult, error: workerError, code, signal });", "    if (refreshWorker === worker) finishFetchJob({ result: workerResult, error: workerError, code, signal });")
replace('server.js', "app.get('/api/sources',", "app.use(require('./.rss-reliability/health.cjs').middleware(fetcher, backgroundJobState));\n\napp.get('/api/sources',")
if '  return window.qmRequestJson(path, { ...rest, headers });' not in modified['public/app.js']:
    replace('public/app.js', "  const res = await fetch(path, { ...rest, headers });", "  return window.qmRequestJson(path, { ...rest, headers });\n  /* legacy-response-start */\n  const res = await fetch(path, { ...rest, headers });")
# Remove the unreachable legacy response parser after replacing its entry point.
legacy_start = modified['public/app.js'].find('  /* legacy-response-start */')
if legacy_start >= 0:
    legacy_end = modified['public/app.js'].index('\nasync function loadSources()', legacy_start)
    modified['public/app.js'] = modified['public/app.js'][:legacy_start] + '}\n' + modified['public/app.js'][legacy_end:]
old = '''      [data] = await Promise.all([
        loadSources(),
        loadEntries({ summary: route.view === 'assets' ? 'full' : 'minimal' }),
      ]);'''
new = '''      const catalogTask = loadSources().then(value => {
        renderSidebar();
        return value;
      }).catch(() => { toast('频道信息暂未同步，文章仍可阅读', 4000); return { refreshing: false }; });
      await loadEntries({ summary: route.view === 'assets' ? 'full' : 'minimal' });
      updateListTitle(); renderList();
      // Catalog is supplementary; never gate first-paint on it.
      void catalogTask;
      data = { refreshing: false };'''
replace('public/app.js', old, new)
replace('public/index.html', '<script src="/app.js?v=separate-channel-20261004"></script>', '<script defer src="/request-json.js?v=recovery-20261015"></script>\n  <script defer src="/app.js?v=recovery-20261015"></script>')
for filename in ['purify.min.js?v=3.4.11', 'lucide-icons.js?v=3', 'podscribe.js?v=6']:
    modified['public/index.html'] = modified['public/index.html'].replace('<script src="/' + filename + '"></script>', '<script defer src="/' + filename + '"></script>')
for name, content in modified.items():
    if name.endswith('.js'):
        subprocess.run(['node', '--check', '--input-type=commonjs'], input=content, text=True, check=True)
backup = root / '.deploy-backups' / ('rss-recovery-' + str(time.time_ns()))
backup.mkdir(parents=True, exist_ok=True)
for name in files:
    (backup / name).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(root / name, backup / name)
destination = root / '.rss-reliability'
if destination.exists(): shutil.copytree(destination, backup / '.rss-reliability')
if source != destination: shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
for name, content in modified.items():
    temporary = root / (name + ('.recovery-tmp.js' if name.endswith('.js') else '.recovery-tmp'))
    temporary.write_text(content)
    if name.endswith('.js'): subprocess.run(['node', '--check', str(temporary)], check=True)
    temporary.replace(root / name)
shutil.copy2(source / 'request-json.js', root / 'public/request-json.js')
print('Installed reliability modules; backup: ' + str(backup))
