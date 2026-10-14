#!/usr/bin/env python3
"""Install the website administrator queue without replacing Reader's other code."""
import argparse
import shutil
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--root', required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
source = Path(__file__).resolve().parent
original = {name: (root / name).read_text() for name in ['server.js', 'public/index.html']}
modified = dict(original)
anchor = "require('./lib/lab-collection').mountLabCollection(app, {"
server = modified['server.js']
if server.count(anchor) != 1:
    raise RuntimeError('Expected exactly one existing lab queue mount')
start = server.index(anchor)
end = server.index('\n});', start) + len('\n});')
mount = server[start:end]
if 'web-collection-process.cjs' not in mount:
    if 'adminAuth: store,' not in mount or 'processLink: async url =>' not in mount or 'getSubmittedEntryByUrl' not in mount:
        raise RuntimeError('Queue mount changed; inspect before installing')
    modified['server.js'] = server[:start] + """require('./lib/lab-collection').mountLabCollection(app, {
  adminAuth: store,
  directory: path.join(__dirname, 'data'),
  validateUrl: value => fetcher.__test.validateSubmittedUrlShape(value),
  processLink: require('./lib/web-collection-process.cjs').createProcessLink({
    fetcher, deepseek, prepareEntryForAiAsset,
    collectionTitle: require('./lib/lab-title').collectionTitle,
  }),
});""" + server[end:]

html = modified['public/index.html']
if 'web-collection.js?v=' not in html:
    if html.count('</head>') != 1 or html.count('</body>') != 1:
        raise RuntimeError('Reader HTML changed')
    html = html.replace('</head>', '  <link rel="stylesheet" href="/web-collection.css?v=1.0.0">\n</head>', 1)
    # Defer preserves execution order after the existing deferred app.js.
    html = html.replace('</body>', '  <script defer src="/web-collection.js?v=1.0.0"></script>\n</body>', 1)
    modified['public/index.html'] = html

copies = {'lib/lab-collection.js': source.parent / 'lab-collection.js',
          'lib/web-collection-process.cjs': source / 'process-link.cjs',
          'public/web-collection.js': source / 'web-collection.js',
          'public/web-collection.css': source / 'web-collection.css'}
for filename, content in modified.items():
    if filename.endswith('.js'):
        subprocess.run(['node', '--check', '--input-type=commonjs'], input=content, text=True, check=True)
for filename, candidate in copies.items():
    if filename.endswith(('.js', '.cjs')):
        subprocess.run(['node', '--check', str(candidate)], check=True)

backup = root / '.deploy-backups' / ('web-collection-' + str(time.time_ns()))
backup.mkdir(parents=True)
for filename in [*original, *copies]:
    dest = root / filename
    if dest.exists():
        (backup / filename).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dest, backup / filename)
for filename, candidate in copies.items():
    dest = root / filename
    tmp = dest.with_name(dest.name + '.queue-tmp')
    shutil.copy2(candidate, tmp)
    tmp.replace(dest)
for filename, content in modified.items():
    dest = root / filename
    tmp = dest.with_name(dest.name + '.queue-tmp')
    tmp.write_text(content)
    tmp.replace(dest)
print('Installed website queue 1.0.0; backup: ' + str(backup))
