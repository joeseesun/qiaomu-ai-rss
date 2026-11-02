import importlib.util
import io
import os
from pathlib import Path
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch


def load(control):
    spec = importlib.util.spec_from_file_location('snapshot_download', Path(__file__).with_name('snapshot.py'))
    module = importlib.util.module_from_spec(spec)
    env = {'RSS_DR_CONTROL_URL': control, 'RSS_DR_CONTROL_KEY': 'fixture',
           'RSS_DR_SSH_TARGET': 'rss-sync@192.0.2.1', 'RSS_DR_SSH_KEY': 'unused',
           'RSS_DR_BACKUP_PASSWORD_FILE': 'unused'}
    with patch.dict(os.environ, env): spec.loader.exec_module(module)
    return module


class DownloadTests(unittest.TestCase):
    def test_known_size_does_not_wait_for_connection_close(self):
        release = threading.Event()
        payload = b'complete encrypted object'
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args): pass
            def do_GET(self):
                self.send_response(200); self.end_headers()
                self.wfile.write(payload); self.wfile.flush()
                release.wait(2); self.close_connection = True
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            module = load('http://127.0.0.1:' + str(server.server_port))
            start = time.monotonic()
            self.assertEqual(module.download('part', len(payload)), payload)
            self.assertLess(time.monotonic()-start, 1)
        finally: release.set(); server.shutdown(); server.server_close(); thread.join()

    def test_trickling_response_has_total_deadline(self):
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args): pass
            def do_GET(self):
                self.send_response(200); self.end_headers()
                try:
                    for _ in range(40):
                        self.wfile.write(b'x'); self.wfile.flush(); time.sleep(0.02)
                except OSError: pass
                self.close_connection = True
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            module = load('http://127.0.0.1:' + str(server.server_port))
            module.DOWNLOAD_DEADLINE = 0.12; module.DOWNLOAD_RETRY_DELAY = 0
            start = time.monotonic()
            with self.assertRaisesRegex(TimeoutError, 'backup_download_deadline'): module.download('part', 1000)
            self.assertLess(time.monotonic()-start, 1.5)
        finally: server.shutdown(); server.server_close(); thread.join()

    def test_invalid_part_size_fails_before_network_request(self):
        module = load('http://example.invalid')
        with patch.object(module.urllib.request, 'urlopen') as request:
            for size in [-1, 48*1024*1024+1, 'large']:
                with self.assertRaisesRegex(ValueError, 'invalid_backup_part_size'): module.download('part', size)
            request.assert_not_called()

    def test_transient_download_failure_retries_same_object(self):
        module = load('http://example.invalid'); module.DOWNLOAD_RETRY_DELAY = 0
        payload = b'verified object'
        with patch.object(module.urllib.request, 'urlopen', side_effect=[TimeoutError('stalled'), io.BytesIO(payload)]) as request:
            self.assertEqual(module.download('part-011.enc', len(payload)), payload)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(request.call_args_list[0].args[0].full_url, request.call_args_list[1].args[0].full_url)


if __name__ == '__main__': unittest.main()
