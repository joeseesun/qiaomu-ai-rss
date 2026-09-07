"""Update the bundled MIT catalog from a reviewed upstream commit, never at runtime."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

parser = argparse.ArgumentParser()
parser.add_argument('--revision', required=True, help='Full upstream commit SHA')
args = parser.parse_args()
if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
    parser.error('Use a full reviewed commit SHA')
base = f'https://raw.githubusercontent.com/timqian/chinese-independent-blogs/{args.revision}/'
raw = urlopen(base + 'blogs-original.csv', timeout=30).read().decode('utf-8-sig')
license_text = urlopen(base + 'LICENSE', timeout=30).read().decode('utf-8')

def safe_url(value):
    try:
        url = urlsplit(value.strip())
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
            return None
        return urlunsplit((url.scheme, url.netloc, url.path or '/', url.query, ''))
    except ValueError:
        return None

items, seen, skipped = [], set(), 0
for row in csv.DictReader(io.StringIO(raw), skipinitialspace=True):
    url, site = safe_url(row.get('RSS feed', '')), safe_url(row.get('Address', ''))
    name = (row.get('Introduction') or '').strip()
    if not url or not site or not name or url in seen:
        skipped += 1
        continue
    seen.add(url)
    tags = list(dict.fromkeys(tag.strip() for tag in (row.get('tags') or '').split(';') if tag.strip()))
    items.append({'id': 'blog-' + hashlib.sha256(url.encode()).hexdigest()[:16], 'name': name, 'url': url, 'site': site, 'tags': tags})
if len(items) < 100:
    raise ValueError('Unexpectedly small catalog; inspect upstream format')
root = Path(__file__).resolve().parent.parent
(root / 'src/data/independent-blogs.json').write_text(json.dumps({'source': 'https://github.com/timqian/chinese-independent-blogs', 'revision': args.revision, 'skipped': skipped, 'items': items}, ensure_ascii=False, indent=2) + '\n')
(root / 'vendor/chinese-independent-blogs/LICENSE').write_text(license_text)
print(f'{len(items)} blogs; {skipped} missing/invalid/duplicate feed rows skipped')
