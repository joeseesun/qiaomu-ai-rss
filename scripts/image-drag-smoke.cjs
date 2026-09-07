const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const evaluate=code=>{const s=execFileSync('obsidian',['vault=Qiaomu RSS QA','eval','code='+code.replace(/\n/g,' ')],{encoding:'utf8'});return s.trim()?JSON.parse(s.slice(3)):null;};
for(let i=0;i<60;i++){if(evaluate('JSON.stringify(!!app.plugins.plugins["qiaomu-ai-rss"]?.images)'))break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
evaluate(String.raw`(()=>{window.__imageDragQA=null;void(async()=>{
const p=app.plugins.plugins['qiaomu-ai-rss'],folder='Image drag QA 011';
if(app.vault.getAbstractFileByPath(folder))throw Error('QA fixture already exists');
const config=app.vault.getConfig('attachmentFolderPath'),load=p.images.load,results=[];
const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name);};
await app.vault.createFolder(folder);const note=await app.vault.create(folder+'/note.md','Image drop test\n\n');
const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
const blob=new Blob([bytes],{type:'image/png'});
try{
await p.openReader();const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0].view;
p.images.load=async()=>blob;
v.showSavedArticle({entry:{id:'qa-image-drag',sourceId:'qa',title:'Image QA',content:'<p>Drag image</p><img src="https://example.com/qa.png">',link:'https://example.com'},rewrite:null,translation:null,fetchedAt:Date.now()},'original');
const leaf=app.workspace.getLeaf('split','vertical');await leaf.openFile(note);await app.workspace.revealLeaf(leaf);
await leaf.setViewState({type:'markdown',state:{file:note.path,mode:'source'}});
let img;for(let i=0;i<60;i++){img=v.reader.querySelector('.qrs-prose img');if(img?.ondragstart)break;await new Promise(r=>setTimeout(r,100));}
check('Loaded reader image exposes native file drag',!!img?.ondragstart);
let relativeDrops=0;
for(const destination of [folder+'/Attachments','./assets','./assets']){
app.vault.setConfig('attachmentFolderPath',destination);
const dt=new DataTransfer();img.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
check('Drag contains image bytes instead of Blob URL: '+destination,dt.files.length===1&&dt.files[0].type==='image/png'&&!dt.getData('text/uri-list'));
const cm=leaf.view.containerEl.querySelector('.cm-content'),rect=cm.getBoundingClientRect();
cm.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+40,clientY:rect.top+30}));
const expected=destination.startsWith('./')?folder+'/assets/':destination+'/';
const expectedCount=destination.startsWith('./')?++relativeDrops:1;
let files;for(let i=0;i<60;i++){files=app.vault.getFiles().filter(f=>f.path.startsWith(expected)&&f.extension==='png');if(files.length===expectedCount)break;await new Promise(r=>setTimeout(r,100));}
check('Native drop saves to configured attachment folder: '+destination,files.length===expectedCount);
check('Saved attachment preserves bytes: '+destination,new Uint8Array(await app.vault.readBinary(files[0])).every((byte,index)=>byte===bytes[index]));
check('Note embeds local attachment: '+destination,leaf.view.editor.getValue().includes(files[0].basename)&&!leaf.view.editor.getValue().includes('blob:'));
}
await app.vault.createBinary(folder+'/local.png',bytes.buffer);
v.showSavedArticle({entry:{id:'qa-native-image',origin:'vault',sourceId:'@vault:'+folder,title:'Local image',markdownPath:folder+'/source.md',markdown:'![[local.png]]'},rewrite:null,translation:null,fetchedAt:Date.now()},'original');
for(let i=0;i<60;i++){img=v.reader.querySelector('.qrs-prose img');if(img?.ondragstart)break;await new Promise(r=>setTimeout(r,100));}
const localDrag=new DataTransfer();img?.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:localDrag}));
check('Vault Markdown attachment also drags as image bytes',localDrag.files.length===1&&localDrag.files[0].size===bytes.byteLength);
window.__imageDragQA={results};leaf.detach();
}finally{
p.images.load=load;app.vault.setConfig('attachmentFolderPath',config);
await app.vault.delete(app.vault.getAbstractFileByPath(folder),true);
const v=app.workspace.getLeavesOfType('qiaomu-ai-rss-reader')[0]?.view;if(v?.entries[0])void v.openArticle(v.entries[0]);
}
})().catch(e=>window.__imageDragQA={error:String(e)});return true})()`);
let result;for(let i=0;i<180;i++){result=evaluate('JSON.stringify(window.__imageDragQA)');if(result)break;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
console.log(result);if(!result||result.error)process.exitCode=1;
else{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/image-drag-smoke.json',JSON.stringify(result,null,2));}
