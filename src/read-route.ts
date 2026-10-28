const PRIMARY = 'https://rss.qiaomu.ai';
const EDGE = 'https://rss-edge.qiaomu.ai';

/** A custom service, query carrying credentials, or non-reading path never leaves its origin. */
export class ReadRoutes {
  private preferred = PRIMARY;
  private until = 0;
  candidates(raw: string): string[] {
    const url = new URL(raw);
    const eligible = [PRIMARY, EDGE].includes(url.origin) && !url.username && !url.password &&
      /^\/api\/(?:sources|entries|sources\/[\w-]+\/entries|entry\/[\w-]+(?:\/(?:rewrite|translation))?)$/.test(url.pathname) &&
      [...url.searchParams.keys()].every(key => ['limit', 'cursor', 'source', 'category', 'q', 'ready', 'summary', 'optIn'].includes(key));
    if (!eligible) return [raw, raw];
    const first = this.until > Date.now() ? this.preferred : url.origin;
    return [first, first === PRIMARY ? EDGE : PRIMARY].map(origin => origin + url.pathname + url.search);
  }
  remember(raw: string) {
    const origin = new URL(raw).origin;
    if ([PRIMARY, EDGE].includes(origin)) { this.preferred = origin; this.until = Date.now() + 300_000; }
  }
}
