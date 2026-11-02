// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { originalTitleOf, titleOf } from '../src/model';
describe('bilingual titles across all sources', () => {
  it.each(['hackernews', 'producthunt', 'podscribe-acquired', 'local:feed', 'user-submitted'])('keeps Chinese above the original for %s', sourceId => {
    const entry={id:'a',sourceId,title:'Building reliable readers',titleZh:'构建可靠的阅读器'};
    expect(titleOf(entry)).toBe('构建可靠的阅读器');
    expect(originalTitleOf(entry)).toBe('Building reliable readers');
  });
  it.each([undefined,'','  ','中文原题','Not a Chinese translation'])('omits empty, duplicate or invalid subtitle %s', titleZh => {
    expect(originalTitleOf({id:'a',sourceId:'blog',title:'中文原题',titleZh})).toBe('');
  });
});

import { RssApi } from '../src/api';
it('requests translation only on primary and reads later results without retrying a write', async () => {
  const calls: {url:string;method?:string}[]=[];
  const api=new RssApi('https://rss.qiaomu.ai',async (url,options)=>{
    calls.push({url,method:options?.method});
    return {status:200,text:JSON.stringify({titles:[{id:'a',title:'Original title',titleZh:options?null:'中文标题'}],pending:!!options})};
  });
  expect((await api.refreshTitles(['a','a'],true)).pending).toBe(true);
  expect((await api.refreshTitles(['a'])).titles[0].titleZh).toBe('中文标题');
  expect(calls).toEqual([{url:'https://rss.qiaomu.ai/api/title-translations',method:'POST'},{url:'https://rss.qiaomu.ai/api/title-translations?ids=a',method:undefined}]);
  api.dispose();
});
