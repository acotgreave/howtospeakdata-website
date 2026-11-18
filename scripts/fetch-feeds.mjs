// Fetches the latest items for each "Latest content" stream defined in
// src/data/site.yaml and writes them to src/data/feeds.json.
//
// - A stream that fails keeps its previous items, so the site never shows
//   empty cards because YouTube or Substack had a bad minute.
// - The output has no timestamps, so the file only changes (and only gets
//   committed by the GitHub Action) when there is genuinely new content.
// - Set YOUTUBE_API_KEY to read playlists via the YouTube Data API. Without
//   it, playlist RSS is used, which only exposes a playlist's first 15 videos.

import { readFile, writeFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { load as loadYaml } from 'js-yaml';

const ROOT = new URL('../', import.meta.url);
const SITE_FILE = new URL('src/data/site.yaml', ROOT);
const OUT_FILE = new URL('src/data/feeds.json', ROOT);
const PER_STREAM = 5;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const text = (x) => (typeof x === 'object' && x !== null ? x['#text'] ?? '' : String(x ?? '')).replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'howtospeakdata.com feed fetcher' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function youtubeRss(param, id, { skipShorts = false } = {}) {
  const xml = await (await get(`https://www.youtube.com/feeds/videos.xml?${param}=${id}`)).text();
  return asArray(parser.parse(xml).feed?.entry)
    .map((e) => ({
      title: text(e.title),
      url: asArray(e.link)[0]?.['@href'] ?? `https://www.youtube.com/watch?v=${e['yt:videoId']}`,
      date: e.published,
      id: e['yt:videoId'],
    }))
    .filter((v) => !(skipShorts && v.url.includes('/shorts/')));
}

async function youtubePlaylistApi(id, key) {
  const items = [];
  let pageToken = '';
  do {
    const api = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    api.search = new URLSearchParams({ part: 'snippet,contentDetails', maxResults: '50', playlistId: id, key, pageToken });
    const data = await (await get(api)).json();
    for (const it of data.items ?? []) {
      const date = it.contentDetails?.videoPublishedAt;
      if (!date) continue; // private or deleted video
      const vid = it.contentDetails.videoId;
      items.push({ title: it.snippet.title, url: `https://www.youtube.com/watch?v=${vid}`, date, id: vid });
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return items;
}

async function rss(url) {
  const doc = parser.parse(await (await get(url)).text());
  if (doc.rss) {
    return asArray(doc.rss.channel?.item).map((i) => ({
      title: text(i.title),
      url: text(i.link),
      date: new Date(text(i.pubDate)).toISOString(),
      // Substack cover image; ask its CDN for an 800px-wide copy
      thumb: i.enclosure?.['@url']?.replace(/(\/image\/fetch\/(?:\$s_![^,]+!,)?)/, '$1w_800,'),
    }));
  }
  // Atom
  return asArray(doc.feed?.entry).map((e) => ({
    title: text(e.title),
    url: asArray(e.link)[0]?.['@href'] ?? '',
    date: new Date(text(e.published || e.updated)).toISOString(),
  }));
}

function fetchStream({ source }) {
  switch (source.type) {
    case 'youtube-playlist':
      return process.env.YOUTUBE_API_KEY
        ? youtubePlaylistApi(source.id, process.env.YOUTUBE_API_KEY)
        : youtubeRss('playlist_id', source.id);
    case 'youtube-channel':
      return youtubeRss('channel_id', source.id, { skipShorts: true });
    case 'rss':
      return rss(source.url);
    default:
      throw new Error(`Unknown source type "${source.type}"`);
  }
}

// The video page says whether a video is a livestream, and if so when it
// starts/started. RSS dates are upload dates, which for streams is when the
// stream was scheduled, not when it airs.
async function youtubeDetails(item) {
  try {
    const html = await (await get(`https://www.youtube.com/watch?v=${item.id}&hl=en`)).text();
    const live = html.match(/"liveBroadcastDetails":(\{[^}]*\})/);
    if (live) {
      const d = JSON.parse(live[1]);
      if (d.startTimestamp) item.date = new Date(d.startTimestamp).toISOString();
      if (d.isLiveNow) item.status = 'live';
      else if (!d.endTimestamp && Date.parse(d.startTimestamp) > Date.now()) item.status = 'upcoming';
    }
  } catch (err) {
    console.log(`  (couldn't read details for ${item.id}: ${err.message})`);
  }
  const maxres = `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`;
  const ok = await fetch(maxres, { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
  item.thumb = ok ? maxres : `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
  return item;
}

const MAX_UPCOMING = 2;

async function latest(items) {
  const seen = new Set();
  let list = items
    .filter((i) => i.title && i.url && !Number.isNaN(Date.parse(i.date)))
    .filter((i) => {
      const k = i.id ?? i.url;
      return seen.has(k) ? false : seen.add(k);
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, PER_STREAM + MAX_UPCOMING);

  if (list.some((i) => i.id)) list = await Promise.all(list.map((i) => (i.id ? youtubeDetails(i) : i)));

  const soon = list
    .filter((i) => i.status)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, MAX_UPCOMING);
  const aired = list
    .filter((i) => !i.status)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, PER_STREAM);

  // Upcoming/live items keep their full start time; aired items just the day.
  return [...soon, ...aired].map(({ title, url, date, status, thumb }) => ({
    title,
    url,
    date: status ? date : date.slice(0, 10),
    ...(status && { status }),
    ...(thumb && { thumb }),
  }));
}

const site = loadYaml(await readFile(SITE_FILE, 'utf8'));
const previous = JSON.parse(await readFile(OUT_FILE, 'utf8').catch(() => '{}'));
const next = {};
let failures = 0;

for (const stream of site.content.streams) {
  try {
    const items = await latest(await fetchStream(stream));
    if (items.length === 0) throw new Error('feed returned no items');
    next[stream.key] = items;
    const soon = items.filter((i) => i.status).map((i) => `${i.status}: "${i.title}"`);
    console.log(`✓ ${stream.key}: ${items.length} items, latest "${items[0].title}"${soon.length ? ` (${soon.join(', ')})` : ''}`);
  } catch (err) {
    failures++;
    next[stream.key] = previous[stream.key] ?? [];
    // ::warning:: shows up as an annotation on the GitHub Actions run
    console.log(`::warning title=Feed ${stream.key} failed::${err.message} (kept previous items)`);
  }
}

const out = JSON.stringify(next, null, 2) + '\n';
if (out !== JSON.stringify(previous, null, 2) + '\n') {
  await writeFile(OUT_FILE, out);
  console.log('feeds.json updated');
} else {
  console.log('No new content');
}

if (failures === site.content.streams.length) process.exit(1);
