#!/usr/bin/env python3
"""Build a versioned server update containing its installer and shared queue."""
import argparse
import hashlib
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent
version = (source / 'VERSION').read_text().strip()
output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
name = 'qiaomu-rss-web-collection-' + version
archive = output / (name + '.tar.gz')
files = ['VERSION', 'README.md', 'install.py', 'process-link.cjs', 'web-collection.js', 'web-collection.css', 'test_install.py', 'package.py']
with tarfile.open(archive, 'w:gz') as tar:
    for filename in files:
        tar.add(source / filename, arcname=name + '/server/web-collection/' + filename)
    for filename in ['lab-collection.js', 'lab-title.js', 'mount-lab-collection.js.txt', 'lab-collection.check.cjs', 'admin-link-queue.check.cjs', 'web-collection.check.cjs']:
        tar.add(source.parent / filename, arcname=name + '/server/' + filename)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / (name + '.tar.gz.sha256')).write_text(digest + '  ' + archive.name + '\n')
print(str(archive)); print(digest)
