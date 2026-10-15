import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from standby import connect, query, encode_response

class StandbyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        (self.root/'manifest.json').write_text(json.dumps({'protocol':1,'id':'s1','revision':0,'createdAt':1}))
        with sqlite3.connect(self.root/'public.sqlite') as db:
            db.executescript('CREATE TABLE sources(id,data,separate); CREATE TABLE entries(id,source,published,data,rewrite,translation,rewrite_ready);')
            for sid, opt, separate in [('a',False,0),('b',True,0),('community',False,1),('disabled',False,0)]:
                db.execute('INSERT INTO sources VALUES(?,?,?)',[sid,json.dumps({'id':sid,'optIn':opt,'enabled':sid!='disabled','category':'article'}),separate])
                for i in range(3):
                    entry={'id':sid+str(i),'sourceId':sid,'title':'hello','content':'body','publishedTs':i}
                    db.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?)',[entry['id'],sid,i,json.dumps(entry),'null','null',i==2])
    def tearDown(self): self.tmp.cleanup()
    def test_default_excludes_opt_in_separate_and_disabled(self):
        entries=query(self.root,'/api/entries',{})[1]['entries']
        self.assertEqual([e['id'] for e in entries],['a2','a1','a0']); self.assertNotIn('content',entries[0])
    def test_cursor_is_compatible_and_has_no_duplicates(self):
        first=query(self.root,'/api/sources/a/entries',{'limit':['2']})[1]
        second=query(self.root,'/api/sources/a/entries',{'cursor':[first['nextCursor']]})[1]
        self.assertEqual([e['id'] for e in second['entries']],['a0'])
        self.assertFalse(second['hasMore'])
    def test_content_and_missing_assets(self):
        self.assertEqual(query(self.root,'/api/entry/a0',{})[1]['entry']['content'],'body')
        self.assertIsNone(query(self.root,'/api/entry/a0/rewrite',{})[1]['rewrite'])
        self.assertEqual(query(self.root,'/api/entry/deleted',{})[0],404)
    def test_compact_transport_preserves_metadata_and_cursor(self):
        payload={'entries':[{'id':'a','title':'标题','summary':'Keep','assets':{'body':'x'*5000},'stats':{},'content':'body'}], 'nextCursor':'2:a','hasMore':True}
        body,encoding=encode_response(payload,'/api/entries',{'X-Rss-List':'reader-v1'})
        value=json.loads(body); self.assertNotIn('assets',value['entries'][0]);self.assertEqual(value['nextCursor'],'2:a');self.assertEqual(value['entries'][0]['summary'],'Keep');self.assertIn('assets',payload['entries'][0])
    def test_gzip_is_negotiated_and_original_detail_is_never_stripped(self):
        import gzip
        payload={'entry':{'id':'a','content':'正文'*3000}}
        body,encoding=encode_response(payload,'/api/entry/a',{'X-Rss-List':'reader-v1','Accept-Encoding':'gzip'})
        self.assertEqual(encoding,'gzip');self.assertEqual(json.loads(gzip.decompress(body)),payload)
        raw,encoding=encode_response(payload,'/api/entry/a',{'Accept-Encoding':'gzip;q=0'})
        self.assertIsNone(encoding);self.assertEqual(json.loads(raw),payload)
    def test_database_is_really_read_only(self):
        with connect(self.root) as db:
            with self.assertRaises(sqlite3.OperationalError): db.execute('DELETE FROM entries')
    def test_unknown_routes_do_not_expose_data(self):
        self.assertEqual(query(self.root,'/api/me',{})[0],404)
        self.assertEqual(query(self.root,'/api/sources/disabled/entries',{})[0],404)

if __name__ == '__main__': unittest.main()
