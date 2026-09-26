import type QiaomuRssPlugin from './main';
import { titleOf, type Entry } from './model';
import { homeProvider, type HomeItem, type HomeProvider } from './qiaomu-home';
import { t } from './i18n';
import { VIEW_TYPE, ReaderView } from './view';

const MAX_ITEMS = 4;

function when(entry: Entry): number {
  return entry.publishedTs ?? (entry.published ? Date.parse(entry.published) || 0 : 0);
}

function relative(ms: number): string {
  if (!ms) return '';
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / 1440), 'day');
}

/** Every article the plugin already has locally: the Qiaomu stream plus personal feeds, newest first, without duplicates. */
function localEntries(plugin: QiaomuRssPlugin): Entry[] {
  const state = plugin.state;
  const seen = new Set<string>();
  const all = [...state.entries, ...state.subscriptions.flatMap(feed => feed.entries)];
  return all.filter(entry => !seen.has(entry.id) && seen.add(entry.id)).sort((a, b) => when(b) - when(a));
}

async function openEntry(plugin: QiaomuRssPlugin, entry: Entry): Promise<void> {
  await plugin.openReader();
  const view = plugin.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
  if (view instanceof ReaderView) view.openEntry(entry);
}

function item(plugin: QiaomuRssPlugin, entry: Entry): HomeItem {
  const image = entry.image?.startsWith('https://') ? entry.image : undefined;
  return {
    id: entry.id,
    title: titleOf(entry),
    subtitle: entry.sourceName ?? '',
    meta: relative(when(entry)),
    icon: entry.audio ? 'podcast' : 'newspaper',
    ...(image ? { image } : {}),
    open: () => openEntry(plugin, entry),
  };
}

/** What Qiaomu RSS shows on Qiaomu Home: the newest unread articles it already has locally. Never fetches. */
export function createHomeProvider(plugin: QiaomuRssPlugin): HomeProvider {
  return homeProvider({
    sections() {
      const read = new Set(plugin.state.readIds);
      const unread = localEntries(plugin).filter(entry => !read.has(entry.id));
      return [{
        id: 'latest',
        title: unread.length ? `${t('home.latest')} · ${unread.length > 99 ? '99+' : unread.length}` : t('home.latest'),
        items: unread.slice(0, MAX_ITEMS).map(entry => item(plugin, entry)),
        empty: t('home.allRead'),
        more: { id: 'open', label: t('home.open'), icon: 'arrow-up-right', run: () => plugin.openReader() },
      }];
    },
    actions() {
      return [{ id: 'add-feed', label: t('home.addFeed'), icon: 'rss', run: () => plugin.manageSubscriptions() }];
    },
    search(query, limit) {
      const q = query.toLowerCase();
      const saved = [...Object.values(plugin.state.favorites), ...Object.values(plugin.state.savedArticles)].map(bundle => bundle.entry);
      const seen = new Set<string>();
      return [...saved, ...localEntries(plugin)]
        .filter(entry => !seen.has(entry.id) && seen.add(entry.id))
        .filter(entry => titleOf(entry).toLowerCase().includes(q) || entry.title.toLowerCase().includes(q) || (entry.sourceName ?? '').toLowerCase().includes(q))
        .slice(0, limit)
        .map(entry => item(plugin, entry));
    },
  });
}
