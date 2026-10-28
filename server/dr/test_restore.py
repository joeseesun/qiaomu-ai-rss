import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class RestoreTests(unittest.TestCase):
    def exercise_restore(self, corrupt_dependency):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); private = root/'private'; private.mkdir()
            for name in ['qmreader.sqlite', 'podscribe-data/cache.sqlite3']:
                p=private/name; p.parent.mkdir(parents=True,exist_ok=True)
                if corrupt_dependency and name.startswith('podscribe'):
                    p.write_bytes(b'not a valid SQLite database'); continue
                db=sqlite3.connect(p)
                try:db.execute('CREATE TABLE fixture(value TEXT)');db.execute("INSERT INTO fixture VALUES('restored')");db.commit()
                finally:db.close()
            password=root/'password';password.write_bytes(b'test-only-restore-password')
            archive=root/'source.tar.gz'
            with tarfile.open(archive,'w:gz') as tar:
                for p in private.iterdir():tar.add(p,arcname=p.name)
            encrypted=root/'source.enc'
            subprocess.run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','200000','-salt','-in',str(archive),'-out',str(encrypted),'-pass','file:'+str(password)],check=True)
            body=encrypted.read_bytes();key='hourly/fixture/part-000.enc'
            meta={'id':'fixture','parts':[{'key':key,'size':len(body),'sha256':hashlib.sha256(body).hexdigest()}],
                  'hmac':hmac.new(hashlib.sha256(password.read_bytes()+b'RSS-DR-MAC-v1').digest(),body,hashlib.sha256).hexdigest(),
                  'databaseSha256':hashlib.sha256((private/'qmreader.sqlite').read_bytes()).hexdigest()}
            objects={'/__dr/backup/'+key:body,'/__dr/backup/hourly/fixture/manifest.json':json.dumps(meta).encode()}
            class Handler(BaseHTTPRequestHandler):
                def log_message(self,*args):pass
                def do_GET(self):
                    if self.headers.get('Authorization')!='Bearer fixture':self.send_error(403);return
                    value=objects[self.path];self.send_response(200);self.send_header('Content-Length',str(len(value)));self.end_headers();self.wfile.write(value)
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                result=subprocess.run([sys.executable,str(Path(__file__).with_name('restore.py')),'hourly/fixture/manifest.json',str(root/'destination')],
                    env={**os.environ,'RSS_DR_CONTROL_URL':'http://127.0.0.1:'+str(server.server_port),'RSS_DR_CONTROL_KEY':'fixture','RSS_DR_BACKUP_PASSWORD_FILE':str(password)},capture_output=True,text=True,timeout=15)
            finally:server.shutdown();server.server_close();thread.join()
            if corrupt_dependency:self.assertNotEqual(result.returncode,0)
            else:
                self.assertEqual(result.returncode,0,result.stderr);self.assertTrue(json.loads(result.stdout)['ok'])
                db=sqlite3.connect(root/'destination/restored/podscribe-data/cache.sqlite3')
                try:self.assertEqual(db.execute('SELECT value FROM fixture').fetchone()[0],'restored')
                finally:db.close()

    def test_actual_restore_cli_restores_dependency_database(self):self.exercise_restore(False)
    def test_actual_restore_cli_rejects_authenticated_corrupt_dependency(self):self.exercise_restore(True)


if __name__=='__main__':unittest.main()
