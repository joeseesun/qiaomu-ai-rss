import test from 'node:test';
import assert from 'node:assert/strict';
import {originJson, handle} from './worker.mjs';
import {emitOrigin, failureCode, routeClass} from './telemetry.mjs';

test('timeout diagnostics distinguish header wait from a stalled response body', async () => {
  for (const phase of ['headers','body']) {
    let metric;
    const fetcher = phase === 'headers' ? async () => new Promise(() => {})
      : async () => new Response(new ReadableStream({start(){}}),{headers:{'Content-Type':'application/json'}});
    await assert.rejects(originJson(new Request('https://rss.test/api/entries'), 'https://primary.invalid','secret',15,fetcher,m=>{metric=m;}),/origin_timeout/);
    assert.equal(metric.reason,'origin_timeout');
    assert.equal(metric.headersMs === null,phase === 'headers');
    assert(metric.elapsedMs >= 10 && metric.elapsedMs < 300);
  }
});
test('diagnostics never include request credentials, query, identifier or raw network error', () => {
  const request = new Request('https://rss.test/api/entry/private-id?token=query-secret',{headers:{Authorization:'Bearer auth-secret',Cookie:'session=cookie-secret'}});
  assert.equal(routeClass(request),'article');
  assert.equal(failureCode(Error('failed https://secret.example/?key=secret')),'connection_error');
  const original=console.log;const logs=[];console.log=x=>logs.push(x);
  try {emitOrigin(request,{ORIGIN_LOGS:'true'},{role:'primary',reason:'origin_timeout',elapsedMs:15});}finally{console.log=original;}
  assert.equal(logs.length,1);assert.doesNotMatch(logs[0],/secret|private-id|token|https|session/);
});
test('a bounded larger read budget accepts a slow healthy primary without any retry',async()=>{
  for (const timeout of [10,100]) {
    let calls=0;
    const result=await handle(new Request('https://rss.test/api/health'),{PRIMARY_ORIGIN:'https://primary.invalid',ORIGIN_KEY:'secret',PRIMARY_TIMEOUT_MS:String(timeout)},async()=>{
      calls++;await new Promise(resolve=>setTimeout(resolve,35));return Response.json({status:'ok'});
    });
    assert.equal(result.status,timeout===10?503:200);assert.equal(calls,1);
  }
});
