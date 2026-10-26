import { describe, expect, it } from 'vitest';
import { initialState, type Bundle } from '../src/model';
import { applyDeletedEntries } from '../src/moderation';
const bundle = (id: string, origin: 'qiaomu' | 'local' = 'qiaomu'): Bundle => ({entry:{id,sourceId:'feed',title:'Article',origin},rewrite:null,translation:null,fetchedAt:1});
describe('server deletion reconciliation',()=>{
  it('removes server copies, favorites and restored channel articles but retains local files and note paths',()=>{
    const remote=bundle('removed'),local=bundle('local','local'),base='https://rss.qiaomu.ai';
    const state=initialState({entries:[remote.entry,local.entry],cache:{removed:remote,local},favorites:{removed:remote,local},savedArticles:{removed:remote},articleNotes:{removed:'saved-note.md'},channelStates:{[JSON.stringify([base,'feed'])]:{entries:[remote.entry,local.entry],bundle:remote,mode:'original',filter:'all',query:'',unread:[],cursor:'',hasMore:false,listTop:0,readerTop:0,articlePending:true}}});
    state.personalArticles.here={baseUrl:base,groupId:'',bundle:remote}; state.personalArticles.other={baseUrl:'https://other.example',groupId:'',bundle:remote};
    applyDeletedEntries(state,['removed'],base);
    expect(state.personalArticles.here).toBeUndefined(); expect(state.personalArticles.other).toBeDefined();
    expect(state.entries).toEqual([local.entry]);expect(state.cache.removed).toBeUndefined();expect(state.favorites.removed).toBeUndefined();expect(state.savedArticles.removed).toBeUndefined();
    expect(state.favorites.local).toEqual(local);expect(state.articleNotes.removed).toBe('saved-note.md');
    expect(Object.values(state.channelStates)[0]).toMatchObject({bundle:null,entries:[local.entry],articlePending:false});
    expect(initialState(JSON.parse(JSON.stringify(state))).deletedEntries[base]).toEqual(['removed']);
    state.entries.push(remote.entry);state.cache.removed=remote;
    applyDeletedEntries(state,[],base);
    expect(state.entries).toEqual([local.entry]);expect(state.cache.removed).toBeUndefined();
  });
  it('keeps identical IDs belonging to local entries or a different service',()=>{
    const local=bundle('same','local'),state=initialState({entries:[local.entry],cache:{same:local}});
    applyDeletedEntries(state,['same'],state.settings.baseUrl);expect(state.cache.same).toEqual(local);
    const remote=bundle('remote');state.cache.remote=remote;applyDeletedEntries(state,['remote'],'https://other.example.com');expect(state.cache.remote).toEqual(remote);
  });
});
