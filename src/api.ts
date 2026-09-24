import { z } from 'zod';
import { bundleSchema, entrySchema, pageSchema, rewriteSchema, serviceUrl, sourceSchema, translationSchema, type Bundle, type Entry } from './model';
import { youtubeEmbedUrl } from './media';
import { fail, t } from './i18n';
const remoteEntrySchema = entrySchema.transform(entry => ({ ...entry, origin: 'qiaomu' as const, markdown: undefined, markdownPath: undefined }));
export interface HttpResponse { status: number; text: string }
export type Transport = (url: string) => Promise<HttpResponse>;
class ApiStatusError extends Error {
  constructor(readonly status: number) { super(t('error.serviceUnavailable', { status })); }
}
const transcriptSchema = z.object({ transcript: z.string(), sourceUrl: z.string().optional() });
const episodePageSchema = z.object({ episodes: z.array(z.object({ show_slug: z.string(), episode_slug: z.string(), title: z.string(), description: z.string().optional(), url: z.string().optional(), published_at: z.string().nullish(), published_relative: z.string().nullish(), views: z.number().int().nonnegative().nullish(), word_count: z.number().int().nonnegative().nullish(), duration_seconds: z.number().int().nonnegative().nullish() })), pagination: z.object({ next_page: z.number().nullable().optional(), has_next: z.boolean().optional() }).nullable().optional() });
function exactPodcastDate(value: string | null | undefined): { published: string; publishedTs: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value || '')) return null;
  const publishedTs = Date.parse(value || '');
  return Number.isFinite(publishedTs) ? { published: new Date(publishedTs).toISOString(), publishedTs } : null;
}
const directTranscriptSchema = z.object({ transcript: z.object({ segments: z.array(z.object({ text: z.string() })) }), episode: z.object({ url: z.string().optional() }).optional() });
function transcriptHtml(value: string): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paragraphs = value.split(/\n+/).map(line => line.trim()).filter(Boolean);
  return paragraphs.map(line => `<p>${escape(line)}</p>`).join('');
}
function normalizedPodcastTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/&amp;/g, '&').replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
}
function episodeVideoInDescription(description: string | undefined): string | null {
  if (!description) return null;
  // Only trust a link explicitly labelled as this episode's video, not a guest's channel or a clip.
  const match = /(?:watch|view)\s+(?:the\s+|this\s+)?episode\s+on\s+youtube\s*[:：]?\s*(https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{11})/i.exec(description);
  const url = match?.[1] || null;
  return youtubeEmbedUrl(url) ? url : null;
}
function matchingVideoEntry(episode: Entry, candidates: Entry[], sourceId: string): Entry | null {
  const title = normalizedPodcastTitle(episode.title);
  const matches = candidates.filter(candidate => {
    const candidateTitle = sourceId === 'joerogan' ? candidate.title.replace(/^Joe Rogan Experience\s*/i, '') : candidate.title;
    return candidate.sourceId === sourceId && youtubeEmbedUrl(candidate.link) &&
      normalizedPodcastTitle(candidateTitle) === title &&
      (!episode.publishedTs || !candidate.publishedTs || Math.abs(episode.publishedTs - candidate.publishedTs) <= 7 * 86400000);
  });
  return matches.length === 1 ? matches[0] : null;
}
function chineseJoeRoganTitle(title: string): string | null {
  const match = /^#(\d+)\s*[-–—]\s*(.+)$/.exec(title);
  return match ? `乔·罗根体验 第 ${match[1]} 期：${match[2]}` : null;
}
export class RssApi {
  private base: string;
  constructor(base: string, private transport: Transport) { this.base = serviceUrl(base); }
  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let timer: number | undefined;
    try {
      const result = await Promise.race([
        this.transport(this.base + path),
        new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(t('error.requestTimeout'))), 20000); }),
      ]);
      if (result.status < 200 || result.status >= 300) throw new ApiStatusError(result.status);
      if (result.text.length > 12_000_000) throw new Error(t('error.responseTooLarge'));
      const parsed = schema.safeParse(JSON.parse(result.text) as unknown);
      if (!parsed.success) throw new Error(t('error.responseIncompatible'));
      return parsed.data;
    } finally { window.clearTimeout(timer); }
  }
  sources() { return this.get('/api/sources', z.object({ sources: z.array(sourceSchema) })); }
  entries(source = '', cursor = '', limit = source ? 40 : 100) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    const path = source ? `/api/sources/${encodeURIComponent(source)}/entries` : '/api/entries';
    return this.get(`${path}?${query}`, pageSchema.extend({ entries: z.array(remoteEntrySchema) }));
  }
  async podcastEpisodes(sourceId: string, cursor = '') {
    const slug = sourceId.replace(/^podscribe-/, '');
    if (!/^podscribe-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourceId)) fail('error.invalidPodcastId');
    const page = Number(cursor || 1);
    if (!Number.isInteger(page) || page < 1 || page > 1000) fail('error.invalidPodcastPage');
    const result = await this.get(`/api/podscribe/podcasts/${slug}/episodes?page=${page}`, episodePageSchema);
    const entries: Entry[] = result.episodes.filter(episode => episode.show_slug === slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episode.episode_slug)).map(episode => {
      const date = exactPodcastDate(episode.published_at);
      return {
        id: `${sourceId}/${episode.episode_slug}`, sourceId, origin: 'qiaomu', podcastSlug: slug, episodeSlug: episode.episode_slug,
        title: episode.title, summary: episode.description?.slice(0, 300) || '',
        titleZh: slug === 'the-joe-rogan-experience' ? chineseJoeRoganTitle(episode.title) : null,
        link: episode.url || `https://podcasts.happyscribe.com/${slug}/${episode.episode_slug}`,
        videoUrl: episodeVideoInDescription(episode.description),
        published: date?.published, publishedTs: date?.publishedTs,
        publishedRelative: episode.published_relative || (!date ? episode.published_at : null),
        podcastViews: episode.views, podcastWordCount: episode.word_count, podcastDurationSeconds: episode.duration_seconds,
      };
    });
    const videoSource = slug === 'all-in-with-chamath-jason-sacks-friedberg' ? 'allin' : slug === 'the-joe-rogan-experience' ? 'joerogan' : null;
    if (videoSource) {
      try {
        const videos = (await this.entries(videoSource, '', 100)).entries;
        for (const entry of entries) {
          const match = matchingVideoEntry(entry, videos, videoSource);
          if (match?.titleZh?.trim()) entry.titleZh = match.titleZh;
          if (match?.link) entry.videoUrl = match.link;
        }
      } catch { /* A missing video channel must not hide the podcast list. */ }
    }
    return { entries, hasMore: !!result.pagination?.has_next, nextCursor: result.pagination?.next_page ? String(result.pagination.next_page) : null };
  }
  async article(id: string, preview?: Entry): Promise<{ bundle: Bundle; warnings: string[] }> {
    if (preview?.podcastSlug && preview.episodeSlug) {
      const slug = preview.podcastSlug, episode = preview.episodeSlug;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(episode)) fail('error.invalidEpisodeId');
      const detail = await this.get(`/api/podscribe/episodes/${slug}/${episode}/transcript`, directTranscriptSchema);
      const text = detail.transcript.segments.map(segment => segment.text.trim()).filter(Boolean).join('\n');
      if (!text) fail('error.noTranscript');
      const entry = { ...preview, content: transcriptHtml(text) };
      const videoSource = slug === 'all-in-with-chamath-jason-sacks-friedberg' ? 'allin' : slug === 'the-joe-rogan-experience' ? 'joerogan' : null;
      if (videoSource) {
        try {
          const page = await this.entries(videoSource, '', 100);
          const match = matchingVideoEntry(entry, page.entries, videoSource);
          entry.videoUrl = match?.link || entry.videoUrl || null;
          if (match?.titleZh?.trim()) entry.titleZh = match.titleZh;
        } catch { /* A video is optional; the source transcript remains readable. */ }
      }
      return { bundle: bundleSchema.parse({ entry, rewrite: null, translation: null, fetchedAt: Date.now() }), warnings: [] };
    }
    const path = `/api/entry/${encodeURIComponent(id)}`;
    const [detail, rewrite, translation] = await Promise.allSettled([
      this.get(path, z.object({ entry: remoteEntrySchema })),
      this.get(`${path}/rewrite`, z.object({ rewrite: rewriteSchema.nullable() })),
      this.get(`${path}/translation`, z.object({ translation: translationSchema.nullable() })),
    ]);
    if (detail.status === 'rejected') throw detail.reason;
    const warnings: string[] = [];
    if (rewrite.status === 'rejected') warnings.push(t('warning.rewriteUnavailable'));
    if (translation.status === 'rejected') warnings.push(t('warning.translationUnavailable'));
    const entry = detail.value.entry;
    if (entry.sourceId === 'allin' || entry.sourceId === 'joerogan' || entry.sourceId.startsWith('podscribe-')) {
      const shortClip = /^(?:https:\/\/)?(?:www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]+(?:[/?#]|$)/.test(entry.link || '');
      if (shortClip) {
        entry.content = '';
        warnings.push(t('warning.shortClip'));
      } else {
        try {
          const { transcript } = await this.get(`${path}/podscribe-transcript`, transcriptSchema);
          entry.content = transcriptHtml(transcript);
        } catch (error) {
          entry.content = '';
          warnings.push(error instanceof ApiStatusError && [404, 409, 422].includes(error.status)
            ? t('warning.noUniqueTranscript')
            : t('warning.transcriptUnavailable'));
        }
      }
    } else if (entry.sourceId && /^lexfridman$/.test(entry.sourceId)) {
      warnings.push(t('warning.shownotesOnly'));
    }
    const bundle = bundleSchema.parse({ entry,
      rewrite: rewrite.status === 'fulfilled' ? rewrite.value.rewrite : detail.value.entry.rewrite ?? null,
      translation: translation.status === 'fulfilled' ? translation.value.translation : null, fetchedAt: Date.now() });
    return { bundle, warnings };
  }
}
