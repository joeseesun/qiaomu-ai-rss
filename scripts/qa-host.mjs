import fs from 'node:fs/promises';
const targets = await (await fetch('http://127.0.0.1:9275/json')).json();
const target = targets.find(t => t.type === 'page' && t.url.startsWith('app://'));
if (!target) throw Error(JSON.stringify(targets.map(t => ({ title: t.title, url: t.url }))));
const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id=0; const calls = new Map(); socket.onmessage = event => { const message=JSON.parse(event.data); if(calls.has(message.id)){calls.get(message.id)(message);calls.delete(message.id);} };
function call(method,params){const current=++id;return new Promise(resolve=>{calls.set(current,resolve);socket.send(JSON.stringify({id:current,method,params}));});}
const code = await fs.readFile(process.argv[2], 'utf8');
const result = await call('Runtime.evaluate',{expression:`(async()=>{${code}\n})()`,awaitPromise:true,returnByValue:true});
console.log(JSON.stringify(result.result || result,null,2)); socket.close();
if (result.result?.exceptionDetails) process.exitCode=1;
