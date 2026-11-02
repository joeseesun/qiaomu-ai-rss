#!/usr/bin/env python3
"""Read-only public projection; no accounts, schedulers or source database access."""
import gzip
import hashlib
import hmac
import json
import os
import mimetypes
import html
import unicodedata
from pathlib import Path
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(os.environ.get('RSS_DR_ROOT', '/var/lib/qiaomu-rss-standby/current'))
KEY = os.environ.get('RSS_DR_ORIGIN_KEY', '')
WEB_ROOT = Path(os.environ.get('RSS_DR_WEB_ROOT', '/opt/qiaomu-apps/qiaomu-rss-web/current'))
WEB_FILES = {'/', '/index.html', '/app.js', '/styles.css', '/request-json.js',
             '/ai-settings.js', '/ai-settings.css', '/ai-providers.js', '/provider-icons.js',
             '/web-collection.js', '/web-collection.css', '/workbench.js', '/workbench.css',
             '/lucide-icons.js', '/purify.min.js', '/podscribe.js', '/podscribe.css', '/favicon.svg', '/privacy.html', '/support.html'}

def snapshot_root(current, expected=''):
    root = current.resolve(strict=True)
    if not expected: return root
    if not re.fullmatch(r'[a-z0-9-]+', expected): raise ValueError('invalid_snapshot')
    if json.loads((root/'manifest.json').read_text()).get('id') != expected:
        generations = (current.parent/'generations').resolve(strict=True)
        candidate = generations/expected
        if candidate.is_symlink(): raise ValueError('invalid_generation_link')
        root = candidate.resolve(strict=True)
        if root.parent != generations: raise ValueError('invalid_generation_path')
    if json.loads((root/'manifest.json').read_text()).get('id') != expected: raise ValueError('snapshot_id_mismatch')
    return root

def public_file(web_root, path):
    article = re.fullmatch(r'/articles/[A-Za-z0-9_%~-]+(?:/(?:rewrite|translation))?/?', path)
    assets = re.fullmatch(r'/assets(?:/(?:rewrite|translation|comments|annotations|chat))?/?', path)
    vendor = re.fullmatch(r'/vendor/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|css|woff2?|svg|png)', path)
    if path not in WEB_FILES and not article and not assets and not vendor: return None
    base = web_root.resolve(strict=True)
    file = (base / ('index.html' if path == '/' or article or assets else path.lstrip('/'))).resolve(strict=True)
    if not file.is_relative_to(base) or not file.is_file() or file.stat().st_size > 12_000_000: raise ValueError('invalid_public_file')
    version = (base/'frontend-version.txt').read_text().strip()
    if not re.fullmatch(r'[a-f0-9]{40}', version): raise ValueError('invalid_frontend_version')
    return file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream', version

def connect(root):
    db = sqlite3.connect('file:' + str((root / 'public.sqlite').resolve()) + '?mode=ro&immutable=1', uri=True)
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA cache_size=-8192')
    return db

def asset_state(asset, kind='rewrite'):
    # A public read-only snapshot cannot promise a live generation job.
    ready = isinstance(asset, dict) and (bool(asset.get('content')) if kind == 'translation' else bool(str(asset.get('body') or '').strip()))
    return {'status': 'ready' if ready else 'unavailable', 'automatic': False, 'retryAfterMs': 0}

def query(root, path, params):
    meta = json.loads((root / 'manifest.json').read_text())
    if meta.get('protocol') != 1:
        raise ValueError('unsupported_snapshot')
    if path in ['/health/live', '/health/ready']:
        with connect(root) as db:
            count = db.execute('SELECT COUNT(*) FROM entries').fetchone()[0]
            if not count: raise ValueError('empty_snapshot')
        return 200, {'ok': True, 'snapshot': meta['id'], 'revision': meta['revision'], 'createdAt': meta['createdAt'], 'entries': count}, meta
    with connect(root) as db:
        source_rows = db.execute('SELECT data,separate FROM sources').fetchall()
        sources = [(json.loads(data), separate) for data, separate in source_rows]
        if path == '/api/sources': return 200, {'sources': [s for s, _ in sources]}, meta
        match = re.fullmatch(r'/api/sources/([^/]+)/entries', path)
        if path == '/api/entries' or match:
            source = unquote(match[1]) if match else params.get('source', [''])[0]
            category = params.get('category', [''])[0]
            opted = set(params.get('optIn', [''])[0].split(','))
            chosen = [s['id'] for s, separate in sources if s.get('enabled') is not False and (not source or s['id'] == source) and (not category or s.get('category') == category) and (bool(match) or not separate or s['id'] == source or category == s.get('category')) and (bool(match) or not s.get('optIn') or s['id'] == source or s['id'] in opted)]
            if match and not chosen: return 404, {'error': 'source not found'}, meta
            try: limit = int(params.get('limit', ['40' if match else '400'])[0])
            except ValueError: limit = 40 if match else 400
            limit = max(1, min(100 if match else 1000, limit))
            if not chosen: return 200, {'entries': [], **({'hasMore': False, 'nextCursor': None} if match else {})}, meta
            sql = 'SELECT data,published,id FROM entries WHERE source IN (' + ','.join('?' for _ in chosen) + ')'
            args = chosen[:]
            if params.get('ready') == ['rewrite']: sql += ' AND rewrite_ready=1'
            terms = unicodedata.normalize('NFKC', params.get('q', [''])[0][:100]).lower().split()
            if terms:
                source_map = {source['id']: source for source, _ in sources}
                def matches(raw, sid):
                    entry = json.loads(raw)
                    source = source_map.get(sid, {})
                    text = ' '.join(str(entry.get(k) or '') for k in ['title','titleZh','summary','summaryZh','content'])
                    text += ' ' + str(source.get('name', '')) + ' ' + str(source.get('category', ''))
                    text = unicodedata.normalize('NFKC', html.unescape(re.sub(r'<[^>]*>', ' ', text))).lower()
                    return all(term in text for term in terms)
                db.create_function('search_matches', 2, matches)
                sql += ' AND search_matches(data,source)'
            cursor = params.get('cursor', [''])[0]
            c = re.fullmatch(r'(\d+):([A-Za-z0-9_-]+)', cursor)
            if match and c:
                sql += ' AND (published<? OR (published=? AND id<?))'
                args += [int(c[1]), int(c[1]), c[2]]
            sql += ' ORDER BY published DESC,id DESC LIMIT ?'
            args.append(limit + 1 if match else limit)
            rows = db.execute(sql, args).fetchall()
            entries = [{k: v for k, v in json.loads(row[0]).items() if k != 'content'} for row in rows[:limit]]
            if params.get('summary', [''])[0] in ['minimal','compact']:
                entries = [{k:v for k,v in entry.items() if k != 'assets'} for entry in entries]
            result = {'entries': entries}
            if match:
                more = len(rows) > limit
                result.update(hasMore=more, nextCursor=(str(rows[limit-1][1]) + ':' + rows[limit-1][2]) if more else None)
            return 200, result, meta
        match = re.fullmatch(r'/api/entry/([^/]+)(?:/(rewrite|translation))?', path)
        if match:
            row = db.execute('SELECT data,rewrite,translation FROM entries WHERE id=?', [unquote(match[1])]).fetchone()
            if not row and re.fullmatch(r'[A-Za-z0-9_-]{6,64}', unquote(match[1])):
                prefix = unquote(match[1])
                candidates = db.execute('SELECT data,rewrite,translation FROM entries WHERE substr(id,1,?)=? LIMIT 2', [len(prefix),prefix]).fetchall()
                if len(candidates) == 1: row = candidates[0]
            if not row: return 404, {'error': 'entry not found'}, meta
            kind = match[2]
            if kind:
                asset = json.loads(row[{'rewrite': 1, 'translation': 2}[kind]])
                return 200, {kind: asset, **asset_state(asset, kind)}, meta
            rewrite = json.loads(row[1])
            return 200, {'entry': json.loads(row[0]), 'rewrite': rewrite, 'rewriteAssetId': '',
                         'readingState': {'rewrite': asset_state(rewrite)}}, meta
        return 404, {'error': 'not_found'}, meta

def encode_response(data, request_path, headers):
    if headers.get('X-Rss-List') == 'reader-v1' and re.fullmatch(r'/api/(entries|sources/[^/]+/entries)', request_path) and isinstance(data.get('entries'), list):
        omitted = {'content', 'assets', 'stats', 'signals', 'rewriteReady', 'rewriteStatus'}
        data = {**data, 'entries': [{k: v for k, v in entry.items() if k not in omitted} for entry in data['entries']]}
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    encodings = [part.strip().lower().split(';') for part in headers.get('Accept-Encoding', '').split(',')]
    use_gzip = any(parts[0] == 'gzip' and not any(re.fullmatch(r'\s*q\s*=\s*0(?:\.0*)?\s*', p) for p in parts[1:]) for parts in encodings)
    return (gzip.compress(body, compresslevel=3, mtime=0), 'gzip') if use_gzip and len(body) > 1024 else (body, None)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        if not KEY or not hmac.compare_digest(self.headers.get('X-Rss-Origin-Key', ''), KEY):
            return self.respond(403, {'error': 'forbidden'})
        u = urlsplit(self.path)
        try:
            root = snapshot_root(ROOT, self.headers.get('X-Rss-Expected-Snapshot', ''))
            web = public_file(WEB_ROOT, u.path)
            if web is not None:
                body, mime, version = web
                meta = json.loads((root/'manifest.json').read_text())
                self.send_response(200); self.send_header('Content-Type', mime); self.send_header('X-Rss-Frontend-Version', version)
                self.send_header('X-Rss-Snapshot',meta['id']); self.send_header('X-Rss-Revision',str(meta['revision']))
                self.send_header('Cache-Control','no-store'); self.send_header('Content-Length',str(len(body))); self.end_headers()
                if self.command != 'HEAD': self.wfile.write(body)
                return
            if u.path.startswith('/media/wechat/'):
                name = unquote(u.path.removeprefix('/media/wechat/'))
                if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}', name): return self.respond(404, {'error': 'not_found'})
                with connect(root) as db: image = db.execute('SELECT digest,mime FROM images WHERE token=?',[name]).fetchone()
                if not image: return self.respond(404, {'error': 'not_found'})
                p = root / 'wechat-images' / (image[0]+'.bin')
                if not p.is_file(): return self.respond(404, {'error': 'not_found'})
                meta = json.loads((root/'manifest.json').read_text())
                data = p.read_bytes()
                self.send_response(200); self.send_header('Content-Type', image[1]); self.send_header('X-Rss-Snapshot',meta['id']); self.send_header('X-Rss-Revision',str(meta['revision'])); self.send_header('Cache-Control','no-store'); self.send_header('Content-Length', str(len(data))); self.end_headers()
                if self.command != 'HEAD': self.wfile.write(data)
                return
            status, data, meta = query(root, u.path, parse_qs(u.query))
            self.respond(status, data, meta)
        except (OSError, sqlite3.Error, ValueError, KeyError): self.respond(503, {'error': 'snapshot_unavailable'})
    def respond(self, status, data, meta=None):
        body, encoding = encode_response(data, urlsplit(self.path).path, self.headers)
        self.send_response(status); self.send_header('Vary', 'Accept-Encoding, X-Rss-List')
        if encoding: self.send_header('Content-Encoding', encoding)
        self.send_header('Content-Type', 'application/json; charset=utf-8'); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(body)))
        if meta:
            self.send_header('X-Rss-Snapshot', meta['id']); self.send_header('X-Rss-Revision', str(meta['revision'])); self.send_header('X-Rss-Snapshot-Time', str(meta['createdAt']))
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def do_POST(self): self.respond(405, {'error': 'read_only'})
    do_PUT = do_DELETE = do_PATCH = do_POST

if __name__ == '__main__':
    if not KEY: raise SystemExit('Missing origin key')
    ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PORT', '3096'))), Handler).serve_forever()
