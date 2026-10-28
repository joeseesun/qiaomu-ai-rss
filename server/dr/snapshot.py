#!/usr/bin/env python3
"""Consistent private backup, public projection and authenticated atomic publication."""
import fcntl
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from backup_download import download_object

BASE = Path(os.environ.get('RSS_DR_WORK', '/var/lib/qiaomu-rss-backup')).resolve()
APP = Path(os.environ.get('RSS_DR_APP', '/opt/qiaomu-apps/qmreader'))
CONTROL = os.environ['RSS_DR_CONTROL_URL']
KEY = os.environ['RSS_DR_CONTROL_KEY']
TARGET = os.environ['RSS_DR_SSH_TARGET']
EXTRA_TARGETS = json.loads(os.environ.get('RSS_DR_EXTRA_TARGETS', '[]'))
BACKUP_ONLY = os.environ.get('RSS_DR_BACKUP_ONLY') == '1'
SKIP_BACKUP = os.environ.get('RSS_DR_SKIP_BACKUP') == '1'
NODE = os.environ.get('RSS_DR_NODE', '/usr/bin/node')
SSHKEY = os.environ['RSS_DR_SSH_KEY']
PASSWORD = Path(os.environ['RSS_DR_BACKUP_PASSWORD_FILE'])

def capture_sqlite(source, target):
    with closing(sqlite3.connect('file:' + str(source) + '?mode=ro', uri=True)) as a, closing(sqlite3.connect(target)) as b:
        a.backup(b, pages=512, sleep=0.05)

def control(op, data=None, payload=None):
    req = urllib.request.Request(CONTROL + '/__dr/' + op, data=payload if payload is not None else json.dumps(data).encode() if data is not None else None,
        method='PUT' if payload is not None else 'POST' if data is not None else 'GET', headers={'User-Agent': 'Qiaomu-RSS-DR/1.0', 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/octet-stream' if payload is not None else 'application/json'})
    with urllib.request.urlopen(req, timeout=120 if payload is not None else 15) as response: return json.load(response)

DOWNLOAD_DEADLINE = 120
DOWNLOAD_SOCKET_TIMEOUT = 15
DOWNLOAD_RETRY_DELAY = 0.5

def download(key, expected_size=None):
    return download_object(CONTROL, KEY, key, expected_size,
        deadline_seconds=DOWNLOAD_DEADLINE, socket_timeout=DOWNLOAD_SOCKET_TIMEOUT,
        retry_delay=DOWNLOAD_RETRY_DELAY)

def private_backup(stage, manifest):
    marker = BASE / 'last-backup.json'
    if not BACKUP_ONLY and marker.exists() and time.time() - json.loads(marker.read_text())['completedAt'] < 3600: return
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
    backup = {**manifest, 'keyId': os.environ.get('RSS_DR_BACKUP_KEY_ID', 'original'), 'parts': parts, 'hmac': mac.hexdigest(), 'encryption': 'AES-256-CBC-PBKDF2-200000+HMAC-SHA256', 'databaseSha256': hashlib.sha256((stage / 'private' / 'qmreader.sqlite').read_bytes()).hexdigest()}
    control('backup/' + prefix + '/manifest.json', payload=json.dumps(backup).encode())
    # Download the uploaded bytes, verify encrypt-then-MAC, then exercise a genuine restore.
    remote_manifest=json.loads(download(prefix+'/manifest.json'))
    verified=stage/'download.enc'
    remote_mac=hmac.new(hashlib.sha256(PASSWORD.read_bytes()+b'RSS-DR-MAC-v1').digest(),digestmod=hashlib.sha256)
    with verified.open('wb') as out:
        for part in remote_manifest['parts']:
            chunk=download(part['key'], part['size'])
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
    for database in restored_dir.rglob('*'):
        if database.suffix not in ['.sqlite', '.sqlite3']: continue
        with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as check:
            if check.execute('PRAGMA quick_check').fetchone()[0] != 'ok': raise RuntimeError('restore_dependency_integrity_failed')
    marker.write_text(json.dumps({'completedAt': time.time(), 'id': manifest['id'], 'remoteManifest': prefix + '/manifest.json', 'restoreVerified': True}))

def commit_projection_cache(stage, public, identifier):
    # Publication is already accepted by the deletion gate. Commit both the
    # public projection and PRIVATE fingerprints through one atomic pointer.
    current = BASE / 'projection-current'
    old = current.resolve() if current.is_symlink() else None
    destination = BASE / ('projection-' + identifier)
    destination.mkdir(mode=0o700)
    shutil.copy2(public / 'public.sqlite', destination / 'public.sqlite')
    shutil.copy2(stage / 'export-state.json', destination / 'state.json')
    pointer = BASE / 'projection-next'
    pointer.unlink(missing_ok=True)
    pointer.symlink_to(destination.name)
    pointer.replace(current)
    if old and old.parent == BASE and old.name.startswith('projection-s') and old != destination:
        shutil.rmtree(old)

def replicate(public, identifier, target):
    ssh = 'ssh -i ' + SSHKEY + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/rss-dr/known_hosts -o ConnectTimeout=10'
    subprocess.run(['rsync', '-rlptz', '--link-dest=/var/lib/qiaomu-rss-standby/current', '-e', ssh, str(public) + '/', target + ':/var/lib/qiaomu-rss-standby/staging/' + identifier + '/'], check=True, timeout=180)
    subprocess.run(['ssh', '-i', SSHKEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/etc/rss-dr/known_hosts', '-o', 'ConnectTimeout=10', target, 'promote', identifier], check=True, timeout=90)


def replicate_all(public, manifest):
    targets = list(dict.fromkeys([TARGET, *EXTRA_TARGETS]))
    if not all(isinstance(t, str) and t.startswith('rss-sync@') and not any(c.isspace() for c in t) for t in targets):
        raise ValueError('invalid_replica_target')
    results = {}
    with ThreadPoolExecutor(max_workers=min(4, len(targets))) as pool:
        futures = {pool.submit(replicate, public, manifest['id'], target): target for target in targets}
        for future in as_completed(futures):
            target = futures[future]
            try:
                future.result()
                results[target] = {**manifest, 'ready': True, 'completedAt': int(time.time()*1000)}
            except Exception as error:
                results[target] = {'id': manifest['id'], 'revision': manifest['revision'], 'ready': False, 'error': type(error).__name__}
    marker = BASE / 'replicas-next.json'
    marker.write_text(json.dumps(results)); marker.replace(BASE / 'replicas.json')
    # The current public router still uses TARGET. Additional replicas are shadow
    # copies until a router verifies their individual generation and revision.
    if not results[TARGET]['ready']:
        raise RuntimeError('routed_replica_unavailable')
    return results


def main():
    if BACKUP_ONLY and SKIP_BACKUP: raise ValueError('backup_only_cannot_skip_backup')
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (BASE / ('backup.lock' if BACKUP_ONLY else 'sync.lock')).open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return
        state = control('begin')
        if not BACKUP_ONLY and not state['idle']: raise RuntimeError('mutation_in_progress')
        if shutil.disk_usage(BASE).free < 2 * 1024**3: raise RuntimeError('insufficient_staging_space')
        identifier = 's' + str(int(time.time()*1000))
        captured_at = int(time.time()*1000)
        with tempfile.TemporaryDirectory(prefix='export-', dir=BASE) as tmp:
            stage = Path(tmp); private = stage / 'private'; private.mkdir(); public = stage / 'public'; public.mkdir()
            src = APP / 'data' / 'qmreader.sqlite'; clone = private / 'qmreader.sqlite'
            capture_sqlite(src, clone)
            for p in (APP / 'data').iterdir():
                if p.name.startswith('qmreader.sqlite') or p.name.endswith('.lock'): continue
                if p.name.endswith(('-wal', '-shm', '.tmp')): continue
                if p.name.endswith(('.sqlite', '.sqlite3')):
                    capture_sqlite(p, private / p.name)
                elif p.is_file(): shutil.copy2(p, private / p.name)
                elif p.is_dir() and p.name in ['wechat-images', 'producthunt-official']: shutil.copytree(p, private / p.name)
            code = private / 'code'; code.mkdir()
            shutil.copy2(APP / 'server.js', code / 'server.js'); shutil.copytree(APP / 'lib', code / 'lib')
            for name in ['scripts','public']:
                if (APP/name).is_dir():shutil.copytree(APP/name,code/name)
            if (APP/'.env').is_file():shutil.copy2(APP/'.env',code/'.env')
            shutil.copytree(Path(__file__).parent, private / 'dr', ignore=shutil.ignore_patterns('__pycache__', '.wrangler'))
            config = private / 'configuration'; config.mkdir()
            config_paths = ['/etc/qmreader.env', '/etc/podscribe.env', '/etc/rss-dr/backup.env', '/etc/rss-dr/sync-key', '/etc/rss-dr/sync-key.pub', '/etc/rss-dr/known_hosts', '/etc/qiaomu-rss-fetch', '/etc/rss-dr/primary.env', '/etc/rss-dr/origin-key', '/etc/rss-dr/control-key', '/etc/systemd/system/qmreader.service', '/etc/systemd/system/qmreader.service.d', '/etc/systemd/system/qiaomu-rss-sync.service', '/etc/systemd/system/qiaomu-rss-sync.timer']
            for pattern in ['qmreader*', 'podscribe*', 'qiaomu-rss*']:
                config_paths.extend(str(p) for p in Path('/etc/systemd/system').glob(pattern))
            for path in dict.fromkeys(config_paths):
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
            if not SKIP_BACKUP:
                podscribe = Path(os.environ.get('RSS_DR_PODSCRIBE_APP', '/opt/qiaomu-apps/podscribe'))
                if (podscribe / 'data').is_dir():
                    captured = private / 'podscribe-data'; captured.mkdir()
                    for p in (podscribe / 'data').iterdir():
                        if p.name.endswith(('-wal', '-shm', '.tmp', '.lock')): continue
                        if p.suffix in ['.sqlite', '.sqlite3']:
                            capture_sqlite(p, captured / p.name)
                        elif p.is_dir(): shutil.copytree(p, captured / p.name)
                        elif p.is_file(): shutil.copy2(p, captured / p.name)
                    podscribe_code = private / 'podscribe-code'; podscribe_code.mkdir()
                    for name in ['app', 'scripts', 'requirements.txt', 'requirements-installed.txt']:
                        original = podscribe / name
                        if original.is_dir(): shutil.copytree(original, podscribe_code / name, ignore=shutil.ignore_patterns('__pycache__'))
                        elif original.is_file(): shutil.copy2(original, podscribe_code / name)
                credentials = Path('/var/lib/qmreader/.getnote')
                if credentials.is_dir(): shutil.copytree(credentials, private / 'getnote-config')
                private_backup(stage, manifest)
            if BACKUP_ONLY:
                print(json.dumps({'ok': True, 'backupOnly': True, 'id': identifier})); return
            # The exporter initializes schema only in a SECOND clone, preserving the original restore artifact.
            export_db = stage / 'export.sqlite'; shutil.copy2(clone, export_db)
            env = {**os.environ, **note_env, 'RSS_DR_STAGE': str(stage), 'QMREADER_DB_FILE': str(export_db), 'QMREADER_DATA_DIR': str(private), 'RSS_DR_PREVIOUS': str(BASE / 'projection-current'), 'RSS_DR_STATE_FILE': str(stage / 'export-state.json')}
            # Reuse unchanged anonymous rows; first run, code/schema changes or
            # a daily reconciliation rebuild in full within the same finite budget.
            subprocess.run([NODE, str(Path(__file__).with_name('export.cjs')), str(public / 'public.sqlite')], env=env, check=True, timeout=600)
            manifest = {**manifest, 'sha256': hashlib.sha256((public / 'public.sqlite').read_bytes()).hexdigest()}
            (public / 'manifest.json').write_text(json.dumps(manifest))
            replicate_all(public, manifest)
            control('publish', manifest)
            commit_projection_cache(stage, public, identifier)
            (BASE / 'last-sync.json').write_text(json.dumps({**manifest, 'completedAt': int(time.time()*1000)}))
            print(json.dumps({'ok': True, 'id': identifier, 'revision': state['revision']}))

if __name__ == '__main__': main()
