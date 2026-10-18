// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { requestUrl, setMockLanguage } from 'obsidian';
import { SourceInput } from '../src/source-input';
import { initialState } from '../src/model';
import { Subscriptions } from '../src/subscriptions';
import { t } from '../src/i18n';
vi.mock('obsidian', async importOriginal => ({...await importOriginal<object>(),Component: class {
  events:(()=>void)[]=[];
  load(){this.onload();} onload(){} onunload(){}
  unload(){this.onunload();for(const done of this.events)done();}
  registerDomEvent(el:HTMLElement,event:string,fn:EventListener){el.addEventListener(event,fn);this.events.push(()=>el.removeEventListener(event,fn));}
}}));
beforeAll(()=>{
  Object.defineProperty(window.crypto,'subtle',{value:webcrypto.subtle,configurable:true});
  function create(this:HTMLElement,tag:string,options:any={}) { if(typeof options==='string')options={cls:options};const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text)el.textContent=options.text;for(const [key,value]of Object.entries({...options.attr,...(options.type?{type:options.type}:{}),...(options.placeholder?{placeholder:options.placeholder}:{})}))el.setAttribute(key,String(value));this.append(el);return el; }
  Object.assign(HTMLElement.prototype,{createEl:create,createDiv(this:HTMLElement,o:any){return create.call(this,'div',o);},createSpan(this:HTMLElement,o:any){return create.call(this,'span',o);},empty(){this.replaceChildren();},setText(value:string){this.textContent=value;},addClass(...v:string[]){this.classList.add(...v);},removeClass(...v:string[]){this.classList.remove(...v);},toggleClass(v:string,on:boolean){this.classList.toggle(v,on);}});
});
let entry:SourceInput,state:ReturnType<typeof initialState>,save:ReturnType<typeof vi.fn>,page:HTMLElement,changed:ReturnType<typeof vi.fn>,search:ReturnType<typeof vi.fn>;
beforeEach(()=>{setMockLanguage('zh');document.body.replaceChildren();vi.mocked(requestUrl).mockReset();page=document.body.createDiv();state=initialState(null);save=vi.fn(async()=>{});changed=vi.fn();search=vi.fn();const plugin:any={state,subscriptions:new Subscriptions(()=>state,save)};entry=new SourceInput(page,plugin,changed,search,t('source.libraryPlaceholder'));entry.load();});
afterEach(()=>entry.unload());
const rss='<rss><channel><title>Test RSS</title></channel></rss>';
const submit=()=>page.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
const status=()=>page.querySelector('.qrs-source-status')!.textContent||'';
const input=(value:string)=>{entry.input.value=value;entry.input.dispatchEvent(new Event('input'));};
const wait=async(fn:()=>boolean)=>vi.waitFor(()=>expect(fn()).toBe(true),{timeout:2000,interval:10});
describe('unified subscription interaction',()=>{
  it('keeps format guidance visible before and after typing and clearing',()=>{
    expect(page.textContent).toContain('支持网站、RSS/XML 和 OPML 链接');entry.input.focus();input('https://example.com/rss');
    expect(page.textContent).toContain('支持网站、RSS/XML 和 OPML 链接');expect(page.querySelector('[aria-label]')).toBeNull();
    (page.querySelector('.qrs-search-clear')as HTMLButtonElement).click();expect(entry.input.value).toBe('');expect(document.activeElement).toBe(entry.input);expect(changed).toHaveBeenLastCalledWith('');
  });
  it('searches names without fetching and protects IME confirmation',()=>{
    input('Lex');submit();expect(search).toHaveBeenCalledWith('Lex');expect(requestUrl).not.toHaveBeenCalled();
    entry.input.dispatchEvent(new CompositionEvent('compositionstart'));input('https://example.com/ime');submit();expect(requestUrl).not.toHaveBeenCalled();
    const key=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,cancelable:true});entry.input.dispatchEvent(key);expect(key.defaultPrevented).toBe(true);
  });
  it('adds a feed once on repeated submit without redownloading and supports undo',async()=>{
    vi.mocked(requestUrl).mockResolvedValue({status:200,text:rss,headers:{ETag:'v1'}} as any);
    input('https://example.com/once');entry.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',cancelable:true}));submit();await wait(()=>status().includes('已添加订阅'));
    expect(requestUrl).toHaveBeenCalledTimes(1);expect(state.subscriptions).toHaveLength(1);expect(state.subscriptions[0].etag).toBe('v1');expect(entry.input.value).toBe('');
    (page.querySelector('.qrs-source-status button')as HTMLButtonElement).click();await wait(()=>state.subscriptions.length===0);
  });
  it('discards late results after input changes and after the panel deactivates',async()=>{
    let done!:(value:any)=>void;vi.mocked(requestUrl).mockImplementation(()=>new Promise(resolve=>done=resolve));
    input('https://example.com/late');submit();await wait(()=>!!done);input('New draft');done({status:200,text:rss,headers:{}});await new Promise(r=>setTimeout(r,20));expect(state.subscriptions).toHaveLength(0);expect(entry.input.value).toBe('New draft');
    input('https://example.com/tab');submit();await wait(()=>vi.mocked(requestUrl).mock.calls.length===2);entry.cancelRead();done({status:200,text:rss,headers:{}});await new Promise(r=>setTimeout(r,20));expect(state.subscriptions).toHaveLength(0);
  });
  it('keeps the failed draft and recovers on retry',async()=>{
    vi.mocked(requestUrl).mockResolvedValue({status:200,text:rss,headers:{}}as any);save.mockRejectedValueOnce(Error('Disk full'));
    input('https://example.com/failure');submit();await wait(()=>status().includes('Disk full'));expect(entry.input.value).toBe('https://example.com/failure');expect(entry.input.disabled).toBe(false);expect(state.subscriptions).toHaveLength(0);
    (page.querySelector('.qrs-source-status button')as HTMLButtonElement).click();await wait(()=>state.subscriptions.length===1);expect(entry.input.value).toBe('');
  });
  it('previews OPML served as XML, preserves duplicates and commits only checked new sources',async()=>{
    state.subscriptions=[];const service=new Subscriptions(()=>state,save);await service.import([{url:'https://example.com/old',name:'Keep name',group:'Keep group'}]);
    const xml='<opml><body><outline text="New group"><outline text="New" xmlUrl="https://example.com/new"/><outline text="Overwrite" xmlUrl="https://example.com/old"/></outline></body></opml>';
    vi.mocked(requestUrl).mockResolvedValue({status:200,text:xml,headers:{}}as any);input('https://example.com/list.xml');submit();await wait(()=>!!page.querySelector('.qrs-source-footer button'));
    expect(page.textContent).toContain('已识别为 OPML');expect(state.subscriptions).toHaveLength(1);expect(page.querySelectorAll('.qrs-source-picks input:disabled')).toHaveLength(1);
    expect(page.querySelector('.qrs-source-form>button')!.classList.contains('qrs-hidden')).toBe(true);
    (page.querySelector('.qrs-source-footer button')as HTMLButtonElement).click();await wait(()=>status().includes('已导入'));
    expect(state.subscriptions.map(f=>[f.name,f.group])).toEqual([['Keep name','Keep group'],['New','New group']]);
  });
});
