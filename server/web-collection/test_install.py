import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
MOUNT = (SOURCE.parent / 'mount-lab-collection.js.txt').read_text().split("\nrequire('./lib/lab-moderation')")[0]

class InstallTest(unittest.TestCase):
    def test_preserves_other_features_data_and_installs_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'public').mkdir(); (root / 'lib').mkdir(); (root / 'data').mkdir()
            (root / 'data/private-state.json').write_text('{"keep":true}')
            (root / 'server.js').write_text('// unrelated production feature\n' + MOUNT + '\n// keep watchdog\n')
            (root / 'public/index.html').write_text('<html><head></head><body><script defer src="/app.js?v=recovery"></script></body></html>')
            (root / 'lib/lab-collection.js').write_text('// old module')
            run = lambda: subprocess.run(['python3', str(SOURCE / 'install.py'), '--root', str(root)], capture_output=True, text=True)
            self.assertEqual(run().returncode, 0)
            tracked = [root / 'server.js', root / 'public/index.html']
            hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in tracked]
            self.assertEqual(run().returncode, 0)
            self.assertEqual(hashes, [hashlib.sha256(p.read_bytes()).hexdigest() for p in tracked])
            self.assertIn('// keep watchdog', tracked[0].read_text())
            self.assertEqual(tracked[1].read_text().count('web-collection.js?v='), 1)
            self.assertEqual((root / 'data/private-state.json').read_text(), '{"keep":true}')
            self.assertEqual(len(list((root / '.deploy-backups').iterdir())), 2)

    def test_changed_mount_fails_without_modifying_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'public').mkdir()
            (root / 'server.js').write_text('// unsupported mount')
            (root / 'public/index.html').write_text('<head></head><body></body>')
            result = subprocess.run(['python3', str(SOURCE / 'install.py'), '--root', str(root)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((root / 'server.js').read_text(), '// unsupported mount')
            self.assertFalse((root / '.deploy-backups').exists())

if __name__ == '__main__':
    unittest.main()
