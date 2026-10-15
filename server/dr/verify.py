#!/usr/bin/env python3
"""Read-only API parity, real replica fault probes and concurrent reads."""
import concurrent.futures,copy,json,os,sys,time,urllib.request
from pathlib import Path
origin_key=Path('/etc/rss-dr/origin-key').read_text().strip();control_key=Path('/etc/rss-dr/control-key').read_text().strip()
def call(host,path,body=None):
 headers={'User-Agent':'Qiaomu-RSS-DR/1.0'}
 if host=='rss-dr.qiaomu.ai':headers['Authorization']='Bearer '+control_key
 else:headers['X-Rss-Origin-Key']=origin_key
 req=urllib.request.Request('https://'+host+path,headers=headers,data=json.dumps(body).encode() if body else None)
 with urllib.request.urlopen(req,timeout=30) as r:return json.load(r),dict(r.headers)
source=call('rss-origin.qiaomu.ai','/api/sources')[0]
replica=call('rss-standby.qiaomu.ai','/api/sources')[0]
assert [x['id'] for x in source['sources']]==[x['id'] for x in replica['sources']]
entries=call('rss-origin.qiaomu.ai','/api/entries?limit=100')[0]['entries'];backup=call('rss-standby.qiaomu.ai','/api/entries?limit=100')[0]['entries']
assert [x['id'] for x in entries]==[x['id'] for x in backup], 'list order mismatch'
paths=['/api/entries?limit=100','/api/sources']
for entry in entries[:3]:
 for suffix in ['', '/rewrite','/translation']:
  path='/api/entry/'+entry['id']+suffix; a=call('rss-origin.qiaomu.ai',path)[0];b=call('rss-standby.qiaomu.ai',path)[0]
  if a!=b and '--allow-view-counter-drift' in sys.argv and not suffix:
   # Snapshots intentionally lag views. Compare all content and all other fields exactly.
   a=copy.deepcopy(a);b=copy.deepcopy(b)
   for payload in (a,b):
    stats=payload.get('entry',{}).get('stats')
    if isinstance(stats,dict):
     for key in ('viewCount','lastViewedAt','updatedAt'):stats.pop(key,None)
  if a!=b:print('DIFFERENCE',path,'primary keys',list(a),'standby keys',list(b));raise AssertionError('detail parity mismatch')
  paths.append(path)
sid=entries[0]['sourceId'];path='/api/sources/'+sid+'/entries?limit=40'
a=call('rss-origin.qiaomu.ai',path)[0];b=call('rss-standby.qiaomu.ai',path)[0]
assert [x['id'] for x in a['entries']]==[x['id'] for x in b['entries']];assert a['nextCursor']==b['nextCursor'];paths.append(path)
if a['nextCursor']:
 path+='&cursor='+a['nextCursor'];a=call('rss-origin.qiaomu.ai',path)[0];b=call('rss-standby.qiaomu.ai',path)[0];assert [x['id'] for x in a['entries']]==[x['id'] for x in b['entries']];paths.append(path)
for mode in ['500','timeout','invalid-json']:
 start=time.monotonic();data,headers=call('rss-dr.qiaomu.ai','/__dr/drill',{'path':'/api/entries?limit=100','mode':mode})
 assert headers.get('X-Rss-Origin')=='standby';assert len(data['entries'])==100
 print(json.dumps({'drill':mode,'origin':headers.get('X-Rss-Origin'),'seconds':round(time.monotonic()-start,2)}))
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 results=list(pool.map(lambda p:call('rss-standby.qiaomu.ai',p)[0],paths[:10]))
print(json.dumps({'parity':True,'sources':len(source['sources']),'concurrency':len(results),'paths':len(paths),'viewCounterDriftAllowed':'--allow-view-counter-drift' in sys.argv}))
