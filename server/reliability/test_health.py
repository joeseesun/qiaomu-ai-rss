import http.server, json, os, subprocess, sys, tempfile, threading, unittest
from pathlib import Path

class RecoveryTest(unittest.TestCase):
    def test_business_failure_restarts_once_then_recovery_is_reported(self):
        payload = {'status': 'critical', 'updateStopped': True}
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode())
            def log_message(self, *args): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='rss-health-') as directory:
                root = Path(directory)
                marker = root / 'restarts'
                # Exercise the real script and subprocess path, never the host systemd.
                command = root / 'systemctl'
                command.write_text('#!' + sys.executable + '\nimport os,sys\nassert sys.argv[1:]==["restart","qmreader"]\nwith open(os.environ["RSS_TEST_RESTARTS"],"a") as f: f.write("restart\\n")\n')
                command.chmod(0o700)
                env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                    RSS_HEALTH_STATE=str(root / 'state.json'),
                    RSS_HEALTH_URL='http://127.0.0.1:%d/api/health' % server.server_port,
                    RSS_TEST_RESTARTS=str(marker))
                def run():
                    return subprocess.run([sys.executable, str(Path(__file__).with_name('check-health.py'))],
                        env=env, check=True, capture_output=True, text=True, timeout=10).stdout
                self.assertIn('[rss-alert]', run())
                self.assertEqual(marker.read_text(), 'restart\n')
                self.assertNotIn('[rss-alert]', run())
                self.assertEqual(marker.read_text(), 'restart\n')
                payload.clear(); payload.update(status='ok', updateStopped=False)
                self.assertIn('[rss-alert]', run())
                self.assertEqual(marker.read_text(), 'restart\n')
                self.assertEqual(json.loads((root / 'state.json').read_text())['status'], 'ok')
                # An unready/invalid endpoint during deployment must not provoke a
                # second restart on its first observation; confirm twice instead.
                (root / 'state.json').unlink()
                payload.clear()
                run()
                self.assertEqual(marker.read_text(), 'restart\n')
                run()
                self.assertEqual(marker.read_text(), 'restart\nrestart\n')
                run()
                self.assertEqual(marker.read_text(), 'restart\nrestart\n')
        finally:
            server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__': unittest.main()
