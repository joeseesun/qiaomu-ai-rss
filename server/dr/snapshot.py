#!/usr/bin/env python3
"""Consistent private backup, public projection and authenticated atomic publication."""
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.request

BASE = Path(os.environ.get('RSS_DR_WORK', '/var/lib/qiaomu-rss-backup'))
APP = Path(os.environ.get('RSS_DR_APP', '/opt/qiaomu-apps/qmreader'))
CONTROL = os.environ['RSS_DR_CONTROL_URL']
KEY = os.environ['RSS_DR_CONTROL_KEY']
TARGET = os.environ['RSS_DR_SSH_TARGET']
SSHKEY = os.environ['RSS_DR_SSH_KEY']
PASSWORD = Path(os.environ['RSS_DR_BACKUP_PASSWORD_FILE'])

def control(op, data=None, payload=None):
    req = urllib.request.Request(CONTROL + '/__dr/' + op, data=payload if payload is not None else json.dumps(data).encode() if data is not None else None,
        method='PUT' if payload is not None else 'POST' if data is not None else 'GET', headers={'User-Agent': 'Qiaomu-RSS-DR/1.0', 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/octet-stream' if payload is not None else 'application/json'})
    with urllib.request.urlopen(req, timeout=120 if payload is not None else 15) as response: return json.load(response)

def download(key):
    request=urllib.request.Request(CONTROL+'/__dr/backup/'+key,headers={'User-Agent':'Qiaomu-RSS-DR/1.0','Authorization':'Bearer '+KEY})
    with urllib.request.urlopen(request,timeout=120) as response:return response.read()

def private_backup(stage, manifest):
    marker = BASE / 'last-backup.json'
    if marker.exists() and time.time() - json.loads(marker.read_text())['completedAt'] < 3600: return
    archive = stage / 'backup.tar.gz'
    # The archive is verified after download. Prefer bounded CPU work on the
    # primary over marginal compression gains that compete with live readers.
    with tarfile.open(archive, 'w:gz', compresslevel=1) as tar:
        for p in (stage / 'private').iterdir(): tar.add(p, arcname=p.name)
    encrypted = stage / 'backup.enc'
    subprocess.run(['openssl', 'enc', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-salt', '-in', str(archive), '-out', str(encrypted), '-pass', 'file:' + str(PASSWORD)], check=True)
    mac = hmac.new(hashlib.sha256(PASSWORD.read_bytes() + b'RSS-DR-MAC-v1').digest(), digestmod=hashlib.sha256)
    parts = []; prefix = 'hourly/' + manifest['id']
    with encrypted.open('rb') as f:
        index = 0
        while chunk := f.read(48 * 1024 * 1024):
            mac.update(chunk); key = prefix + f'/part-{index:03d}.enc'
            control('backup/' + key, payload=chunk); parts.append({'key': key, 'sha256': hashlib.sha256(chunk).hexdigest(), 'size': len(chunk)}); index += 1
    backup = {**manifest, 'parts': parts, 'hmac': mac.hexdigest(), 'encryption': 'AES-256-CBC-PBKDF2-200000+HMAC-SHA256', 'databaseSha256': hashlib.sha256((stage / 'private' / 'qmreader.sqlite').read_bytes()).hexdigest()}
    control('backup/' + prefix + '/manifest.json', payload=json.dumps(backup).encode())
    # Download the uploaded bytes, verify encrypt-then-MAC, then exercise a genuine restore.
    remote_manifest=json.loads(download(prefix+'/manifest.json'))
    verified=stage/'download.enc'
    remote_mac=hmac.new(hashlib.sha256(PASSWORD.read_bytes()+b'RSS-DR-MAC-v1').digest(),digestmod=hashlib.sha256)
    with verified.open('wb') as out:
        for part in remote_manifest['parts']:
            chunk=download(part['key'])
            if hashlib.sha256(chunk).hexdigest()!=part['sha256']:raise RuntimeError('remote_backup_checksum_failed')
            remote_mac.update(chunk);out.write(chunk)
    if not hmac.compare_digest(remote_mac.hexdigest(),backup['hmac']):raise RuntimeError('remote_backup_mac_failed')
    restored = stage / 'restored.tar.gz'
    subprocess.run(['openssl', 'enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', str(verified), '-out', str(restored), '-pass', 'file:' + str(PASSWORD)], check=True)
    restored_dir = stage / 'restore'; restored_dir.mkdir()
    with tarfile.open(restored, 'r:gz') as tar: tar.extractall(restored_dir, filter='data')
    restored_db = restored_dir / 'qmreader.sqlite'
    if hashlib.sha256(restored_db.read_bytes()).hexdigest() != backup['databaseSha256']: raise RuntimeError('restore_checksum_failed')
    with sqlite3.connect('file:' + str(restored_db) + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok': raise RuntimeError('restore_integrity_failed')
    marker.write_text(json.dumps({'completedAt': time.time(), 'id': manifest['id'], 'remoteManifest': prefix + '/manifest.json', 'restoreVerified': True}))

def main():
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (BASE / 'sync.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        state = control('begin')
        if not state['idle']: raise RuntimeError('mutation_in_progress')
        if shutil.disk_usage(BASE).free < 2 * 1024**3: raise RuntimeError('insufficient_staging_space')
        identifier = 's' + str(int(time.time()*1000))
        captured_at = int(time.time()*1000)
        with tempfile.TemporaryDirectory(prefix='export-', dir=BASE) as tmp:
            stage = Path(tmp); private = stage / 'private'; private.mkdir(); public = stage / 'public'; public.mkdir()
            src = APP / 'data' / 'qmreader.sqlite'; clone = private / 'qmreader.sqlite'
            with sqlite3.connect('file:' + str(src) + '?mode=ro', uri=True) as source, sqlite3.connect(clone) as destination: source.backup(destination, pages=512, sleep=0.05)
            for p in (APP / 'data').iterdir():
                if p.name.startswith('qmreader.sqlite') or p.name.endswith('.lock'): continue
                if p.is_file(): shutil.copy2(p, private / p.name)
                elif p.is_dir() and p.name in ['wechat-images', 'producthunt-official']: shutil.copytree(p, private / p.name)
            code = private / 'code'; code.mkdir()
            shutil.copy2(APP / 'server.js', code / 'server.js'); shutil.copytree(APP / 'lib', code / 'lib')
            for name in ['scripts','public']:
                if (APP/name).is_dir():shutil.copytree(APP/name,code/name)
            if (APP/'.env').is_file():shutil.copy2(APP/'.env',code/'.env')
            shutil.copytree(Path(__file__).parent, private / 'dr', ignore=shutil.ignore_patterns('__pycache__', '.wrangler'))
            config = private / 'configuration'; config.mkdir()
            for path in ['/etc/rss-dr/primary.env', '/etc/rss-dr/origin-key', '/etc/rss-dr/control-key', '/etc/systemd/system/qmreader.service', '/etc/systemd/system/qmreader.service.d', '/etc/systemd/system/qiaomu-rss-sync.service', '/etc/systemd/system/qiaomu-rss-sync.timer']:
                original = Path(path)
                if original.is_dir(): shutil.copytree(original, config / original.name)
                elif original.is_file(): shutil.copy2(original, config / original.name)
            for name in ['package.json', 'package-lock.json']:
                if (APP / name).exists(): shutil.copy2(APP / name, code / name)
            # These private transcript archives live outside APP/data and must survive
            # a clean-host restore. The public exporter reads the captured copies too.
            note_env = {}
            for key, default in {
                'QMREADER_PODCAST_NOTES_DIR': '/var/lib/qmreader-podcast-notes',
                'QMREADER_PODSCRIBE_NOTES_DIR': '/var/lib/qmreader-podscribe-notes',
                'QMREADER_YOUTUBE_NOTES_DIR': '/var/lib/qmreader-youtube-notes',
            }.items():
                original = Path(os.environ.get(key, default))
                captured = private / 'external-state' / Path(default).name
                if original.is_dir():
                    shutil.copytree(original, captured, ignore=shutil.ignore_patterns('*.tmp', '*.lock'))
                note_env[key] = str(captured)
            manifest = {'protocol': 1, 'id': identifier, 'revision': state['revision'], 'createdAt': captured_at, 'productionCodeSha256': hashlib.sha256((APP / 'server.js').read_bytes()).hexdigest()}
            # An expired or broken public projection must not suppress the private
            # disaster-recovery backup. This returns only after a real restore check.
            private_backup(stage, manifest)
            # The exporter initializes schema only in a SECOND clone, preserving the original restore artifact.
            export_db = stage / 'export.sqlite'; shutil.copy2(clone, export_db)
            env = {**os.environ, **note_env, 'RSS_DR_STAGE': str(stage), 'QMREADER_DB_FILE': str(export_db), 'QMREADER_DATA_DIR': str(private)}
            # A full archive can exceed four wall-clock minutes on a shared CPU,
            # even with batched hydration. Keep a finite export budget separate
            # from private backup verification and network publication.
            subprocess.run(['/usr/bin/node', str(Path(__file__).with_name('export.cjs')), str(public / 'public.sqlite')], env=env, check=True, timeout=600)
            manifest = {**manifest, 'sha256': hashlib.sha256((public / 'public.sqlite').read_bytes()).hexdigest()}
            (public / 'manifest.json').write_text(json.dumps(manifest))
            ssh = 'ssh -i ' + SSHKEY + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/rss-dr/known_hosts -o ConnectTimeout=10'
            subprocess.run(['rsync', '-rlptz', '--link-dest=/var/lib/qiaomu-rss-standby/current', '-e', ssh, str(public) + '/', TARGET + ':/var/lib/qiaomu-rss-standby/staging/' + identifier + '/'], check=True, timeout=180)
            subprocess.run(['ssh', '-i', SSHKEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/etc/rss-dr/known_hosts', TARGET, 'promote', identifier], check=True, timeout=90)
            control('publish', manifest)
            (BASE / 'last-sync.json').write_text(json.dumps({**manifest, 'completedAt': int(time.time()*1000)}))
            print(json.dumps({'ok': True, 'id': identifier, 'revision': state['revision']}))

if __name__ == '__main__': main()
