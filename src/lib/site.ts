import { load } from 'js-yaml';
import raw from '../data/site.yaml?raw';
import feedsJson from '../data/feeds.json';

export const site = load(raw) as any;

export type FeedItem = {
  title: string;
  url: string;
  /** YYYY-MM-DD, or a full ISO time for upcoming/live streams */
  date: string;
  status?: 'upcoming' | 'live';
  thumb?: string;
};
export const feeds = feedsJson as Record<string, FeedItem[]>;

/** Resolve a path inside /public against the site's base path. */
export const asset = (path: string) => import.meta.env.BASE_URL.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

/** "" means "not ready yet": hide the button. Relative paths get the base path. */
export const href = (url: string) => (!url ? '' : /^(https?:|mailto:|#)/.test(url) ? url : asset(url));

export const formatDate = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Build-time fallback in UTC; the page script swaps in the visitor's local time. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });

/** Video ID and start time (seconds) from a youtube.com/watch?v=… or youtu.be/… URL. */
export function youtube(url: string) {
  const u = new URL(url);
  const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v') ?? '';
  // t=15, t=15s or t=1m5s
  const t = (u.searchParams.get('t') ?? '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = t ? (+(t[1] ?? 0)) * 3600 + (+(t[2] ?? 0)) * 60 + (+(t[3] ?? 0)) : 0;
  return { id, start: start || undefined };
}

/** Look up a file imported from src/assets/<folder>/ by its file name. */
export function pick<T>(files: Record<string, T>, name: string): T {
  const hit = Object.entries(files).find(([path]) => path.endsWith('/' + name));
  if (!hit) throw new Error(`Image "${name}" not found. Check the file name in site.yaml.`);
  return hit[1];
}
