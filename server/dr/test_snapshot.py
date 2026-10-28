import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class SnapshotOrderingTest(unittest.TestCase):
    def test_export_failure_cannot_prevent_private_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'app'
            (app / 'data').mkdir(parents=True)
            (app / 'lib').mkdir()
            (app / 'server.js').write_text('// fixture')
            with sqlite3.connect(app / 'data/qmreader.sqlite') as db:
                db.execute('CREATE TABLE fixture(value TEXT)')
                db.execute("INSERT INTO fixture VALUES('preserve me')")
            env = {'RSS_DR_WORK': str(root / 'work'), 'RSS_DR_APP': str(app),
                   'RSS_DR_CONTROL_URL': 'https://example.invalid',
                   'RSS_DR_CONTROL_KEY': 'fixture', 'RSS_DR_SSH_TARGET': 'fixture',
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
