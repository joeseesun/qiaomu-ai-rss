import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class SnapshotOrderingTest(unittest.TestCase):
    def test_private_backup_download_restore_and_corrupt_part_rejection(self):
        for corrupt in [False, True]:
            with self.subTest(corrupt=corrupt), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                private = root / 'private'
                private.mkdir()
                (root / 'password').write_text('test-only-backup-password')
                with sqlite3.connect(private / 'qmreader.sqlite') as db:
                    db.execute('CREATE TABLE fixture(value TEXT)')
                    db.execute("INSERT INTO fixture VALUES('complete source data')")
                (private / 'private-notes.json').write_text('{"transcript":"complete private notes"}')
                env = {'RSS_DR_WORK': str(root), 'RSS_DR_APP': str(root),
                       'RSS_DR_CONTROL_URL': 'https://example.invalid', 'RSS_DR_CONTROL_KEY': 'fixture',
                       'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1', 'RSS_DR_SSH_KEY': str(root / 'key'),
                       'RSS_DR_BACKUP_PASSWORD_FILE': str(root / 'password')}
                spec = importlib.util.spec_from_file_location('snapshot_roundtrip', Path(__file__).with_name('snapshot.py'))
                module = importlib.util.module_from_spec(spec)
                objects = {}
                def upload(op, data=None, payload=None):
                    objects[op.removeprefix('backup/')] = payload
                def download(key):
                    value = objects[key]
                    return bytes([value[0] ^ 1]) + value[1:] if corrupt and key.endswith('.enc') else value
                with patch.dict(os.environ, env):
                    spec.loader.exec_module(module)
                    with patch.object(module, 'control', side_effect=upload), patch.object(module, 'download', side_effect=download):
                        if corrupt:
                            with self.assertRaisesRegex(RuntimeError, 'remote_backup_checksum_failed'):
                                module.private_backup(root, {'id': 'fixture', 'protocol': 1})
                            self.assertFalse((root / 'last-backup.json').exists())
                        else:
                            module.private_backup(root, {'id': 'fixture', 'protocol': 1})
                            self.assertTrue(json.loads((root / 'last-backup.json').read_text())['restoreVerified'])
                            self.assertEqual((root / 'restore/private-notes.json').read_text(), (private / 'private-notes.json').read_text())

    def test_publication_failure_keeps_cache_and_retry_commits_pair(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            app = root / 'app'
            (app / 'data').mkdir(parents=True)
            (app / 'lib').mkdir()
            (app / 'server.js').write_text('// fixture')
            with sqlite3.connect(app / 'data/qmreader.sqlite') as db:
                db.execute('CREATE TABLE entries(id TEXT)')
            work = root / 'work'
            old = work / 'projection-sold'
            old.mkdir(parents=True)
            (old / 'state.json').write_text('old state')
            (old / 'public.sqlite').write_text('old projection')
            (work / 'projection-current').symlink_to(old.name)
            env = {'RSS_DR_WORK': str(work), 'RSS_DR_APP': str(app),
                   'RSS_DR_CONTROL_URL': 'https://example.invalid', 'RSS_DR_CONTROL_KEY': 'fixture',
                   'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1', 'RSS_DR_SSH_KEY': str(root / 'key'),
                   'RSS_DR_BACKUP_PASSWORD_FILE': str(root / 'password')}
            for key in ['QMREADER_PODCAST_NOTES_DIR', 'QMREADER_PODSCRIBE_NOTES_DIR', 'QMREADER_YOUTUBE_NOTES_DIR']:
                env[key] = str(root / 'absent')
            spec = importlib.util.spec_from_file_location('snapshot_commit', Path(__file__).with_name('snapshot.py'))
            module = importlib.util.module_from_spec(spec)
            fail = True
            def control(op, data=None):
                if op == 'begin': return {'idle': True, 'revision': 12}
                if op == 'publish' and fail: raise RuntimeError('revision_changed')
            def command(args, **kwargs):
                if args[0] == '/usr/bin/node':
                    self.assertEqual(Path(kwargs['env']['RSS_DR_PREVIOUS']).resolve(), old)
                    Path(args[-1]).write_text('new projection')
                    Path(kwargs['env']['RSS_DR_STATE_FILE']).write_text('new state')
            with patch.dict(os.environ, env):
                spec.loader.exec_module(module)
                with patch.object(module, 'control', side_effect=control), \
                     patch.object(module, 'private_backup'), \
                     patch.object(module.subprocess, 'run', side_effect=command):
                    with self.assertRaisesRegex(RuntimeError, 'revision_changed'): module.main()
                    self.assertEqual((work / 'projection-current').resolve(), old)
                    self.assertEqual((old / 'state.json').read_text(), 'old state')
                    self.assertFalse((work / 'last-sync.json').exists())
                    fail = False
                    module.main()
            current = work / 'projection-current'
            self.assertEqual((current / 'state.json').read_text(), 'new state')
            self.assertEqual((current / 'public.sqlite').read_text(), 'new projection')
            self.assertFalse(old.exists())
            self.assertEqual(json.loads((work / 'last-sync.json').read_text())['revision'], 12)

    def test_conflicting_backup_flags_cannot_report_success(self):
        env = {'RSS_DR_CONTROL_URL': 'https://example.invalid', 'RSS_DR_CONTROL_KEY': 'fixture',
               'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1', 'RSS_DR_SSH_KEY': 'unused',
               'RSS_DR_BACKUP_PASSWORD_FILE': 'unused', 'RSS_DR_BACKUP_ONLY': '1', 'RSS_DR_SKIP_BACKUP': '1'}
        spec = importlib.util.spec_from_file_location('snapshot_flags', Path(__file__).with_name('snapshot.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, env):
            spec.loader.exec_module(module)
            with self.assertRaisesRegex(ValueError, 'backup_only_cannot_skip_backup'): module.main()

    def test_captured_wal_database_is_self_contained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = {'RSS_DR_WORK': directory, 'RSS_DR_CONTROL_URL': 'https://example.invalid',
                   'RSS_DR_CONTROL_KEY': 'fixture', 'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1',
                   'RSS_DR_SSH_KEY': 'unused', 'RSS_DR_BACKUP_PASSWORD_FILE': 'unused'}
            spec = importlib.util.spec_from_file_location('snapshot_wal', Path(__file__).with_name('snapshot.py'))
            module = importlib.util.module_from_spec(spec)
            writer = sqlite3.connect(root / 'source.sqlite')
            try:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('CREATE TABLE fixture(value TEXT)')
                writer.execute("INSERT INTO fixture VALUES('committed in WAL')")
                writer.commit()
                self.assertTrue((root / 'source.sqlite-wal').exists())
                with patch.dict(os.environ, env):
                    spec.loader.exec_module(module)
                    module.capture_sqlite(root / 'source.sqlite', root / 'captured.sqlite')
                # A restore uses only the captured main file, after all capture connections close.
                reader = sqlite3.connect('file:' + str(root / 'captured.sqlite') + '?mode=ro&immutable=1', uri=True)
                try:
                    self.assertEqual(reader.execute('SELECT value FROM fixture').fetchone()[0], 'committed in WAL')
                    self.assertEqual(reader.execute('PRAGMA quick_check').fetchone()[0], 'ok')
                finally: reader.close()
                self.assertFalse((root / 'captured.sqlite-wal').exists())
            finally: writer.close()

    def test_failed_replica_does_not_prevent_other_transfer(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {'RSS_DR_WORK': directory, 'RSS_DR_CONTROL_URL': 'https://example.invalid',
                   'RSS_DR_CONTROL_KEY': 'fixture', 'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1',
                   'RSS_DR_EXTRA_TARGETS': '["rss-sync@192.0.2.2"]',
                   'RSS_DR_SSH_KEY': 'unused', 'RSS_DR_BACKUP_PASSWORD_FILE': 'unused'}
            spec = importlib.util.spec_from_file_location('snapshot_targets', Path(__file__).with_name('snapshot.py'))
            module = importlib.util.module_from_spec(spec)
            visited = []
            def transfer(public, identifier, target):
                visited.append(target)
                if target.endswith('.1'): raise OSError('offline')
            with patch.dict(os.environ, env):
                spec.loader.exec_module(module)
                with patch.object(module, 'replicate', side_effect=transfer):
                    with self.assertRaisesRegex(RuntimeError, 'routed_replica_unavailable'):
                        module.replicate_all(Path(directory), {'id': 's123', 'revision': 9})
            status = json.loads((Path(directory) / 'replicas.json').read_text())
            self.assertEqual(set(visited), {'rss-sync@192.0.2.1', 'rss-sync@192.0.2.2'})
            self.assertFalse(status['rss-sync@192.0.2.1']['ready'])
            self.assertTrue(status['rss-sync@192.0.2.2']['ready'])
            self.assertEqual(status['rss-sync@192.0.2.2']['revision'], 9)

    def test_export_failure_cannot_prevent_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            app = root / 'app'
            (app / 'data').mkdir(parents=True)
            (app / 'lib').mkdir()
            (app / 'server.js').write_text('// fixture')
            with sqlite3.connect(app / 'data/qmreader.sqlite') as db:
                db.execute('CREATE TABLE fixture(value TEXT)')
                db.execute("INSERT INTO fixture VALUES('preserve me')")
            env = {'RSS_DR_WORK': str(root / 'work'), 'RSS_DR_APP': str(app),
                   'RSS_DR_CONTROL_URL': 'https://example.invalid',
                   'RSS_DR_CONTROL_KEY': 'fixture', 'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1',
                   'RSS_DR_SSH_KEY': str(root / 'key'),
                   'RSS_DR_BACKUP_PASSWORD_FILE': str(root / 'password')}
            notes = root / 'notes'
            notes.mkdir()
            (notes / 'episode.json').write_text('{"transcript":"private source"}')
            (notes / 'episode.json.1.tmp').write_text('unfinished')
            for key in ['QMREADER_PODCAST_NOTES_DIR', 'QMREADER_PODSCRIBE_NOTES_DIR', 'QMREADER_YOUTUBE_NOTES_DIR']:
                env[key] = str(notes)
            spec = importlib.util.spec_from_file_location('snapshot_fixture', Path(__file__).with_name('snapshot.py'))
            module = importlib.util.module_from_spec(spec)
            events = []
            def backup(stage, manifest):
                with sqlite3.connect(stage / 'private/qmreader.sqlite') as db:
                    self.assertEqual(db.execute('SELECT value FROM fixture').fetchone()[0], 'preserve me')
                self.assertNotIn('sha256', manifest)  # No unfinished projection is claimed.
                captured = stage / 'private/external-state/qmreader-podcast-notes'
                self.assertEqual((captured / 'episode.json').read_text(), (notes / 'episode.json').read_text())
                self.assertFalse((captured / 'episode.json.1.tmp').exists())
                events.append('verified-private-backup')
            def failed_export(*args, **kwargs):
                events.append('export')
                raise subprocess.TimeoutExpired(args[0], 240)
            with patch.dict(os.environ, env):
                spec.loader.exec_module(module)
                with patch.object(module, 'control', return_value={'idle': True, 'revision': 7}), \
                     patch.object(module, 'private_backup', side_effect=backup), \
                     patch.object(module.subprocess, 'run', side_effect=failed_export):
                    with self.assertRaises(subprocess.TimeoutExpired):
                        module.main()
            self.assertEqual(events, ['verified-private-backup', 'export'])
            self.assertFalse((root / 'work/last-sync.json').exists())


if __name__ == '__main__':
    unittest.main()
