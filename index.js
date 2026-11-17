// 千千音乐 / Qianqian Music — a MyGo Music source plugin.
//
// The web app talks to api-qianqian.91q.com. Every call needs a signature:
// take the parameters, add appid and timestamp and from=web, sort them, join
// them as k=v&k=v, append the shared secret, md5 it, and send it back as sign.
// No login, no cookie. The play url comes from /v1/song/tracklink, and its
// rate picks the bitrate: 128 / 320 / 3000 for FLAC.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://api-qianqian.91q.com";
const APPID = "16073360";
const SECRET = "0b50b02fd0d73a9c4c8c3a781c30845f";
const PAGE = 30;

const t = host.t;
const fail = (code, message) => {
  const e = new Error(message || code);
  e.code = code;
  return e;
};

// ---------------------------------------------------------------- md5

// The signature is an md5, and the plugin runtime has no crypto, so here is
// the digest written out.
function md5(input) {
  const bytes = [];
  const str = unescape(encodeURIComponent(String(input)));
  for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));

  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // A JavaScript shift counts modulo 32, so the length goes out as one low
  // word and four zero bytes rather than eight shifted bytes.
  for (let i = 0; i < 4; i++) bytes.push((bitLen >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push(0);

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) {
      const o = chunk + i * 4;
      M[i] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      const shift = S[(i >> 4) * 4 + (i % 4)];
      const rotated = (((F << shift) | (F >>> (32 - shift)))) >>> 0;
      const old = D;
      A = D;
      D = C;
      C = B;
      B = (B + rotated) >>> 0;
      void old;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const hex = (n) => {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, "0");
    return s;
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ---------------------------------------------------------------- fetch

function content(param) {
  const ts = Math.floor(Date.now() / 1000);
  const all = Object.assign({}, param, { appid: APPID, timestamp: ts, from: "web" });
  const raw = Object.keys(all)
    .sort()
    .map((k) => `${k}=${all[k]}`)
    .join("&");
  const sign = md5(raw + SECRET);
  return Object.assign({}, param, { appid: APPID, timestamp: ts, sign, from: "web" });
}

function timeout() {
  try {
    return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
  } catch {
    return undefined;
  }
}

async function text(url) {
  const init = {
    headers: {
      "User-Agent": UA,
      Referer: "https://music.91q.com/",
      Accept: "application/json, text/plain, */*",
    },
  };
  const signal = timeout();
  if (signal) init.signal = signal;
  const res = await fetch(url, init);
  const body = await res.text();
  if (res.status >= 400) throw fail("unavailable", t("Qianqian did not answer"));
  return body;
}

async function api(path, param) {
  const signed = content(param);
  const query = Object.keys(signed)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k])}`)
    .join("&");
  const d = JSON.parse(await text(`${BASE}${path}?${query}`));
  if (!d || (d.errno && d.errno !== 22000)) {
    throw fail("unavailable", t("Qianqian did not answer"));
  }
  return d.data;
}

async function once(fn, attempts) {
  let last;
  for (let i = 0; i < (attempts || 2); i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// ---------------------------------------------------------------- helpers

function htmlDecode(s) {
  return String(s == null ? "" : s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ms(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return n < 10000 ? Math.round(n * 1000) : Math.round(n);
}

// Qianqian's pictures come whole; the image server takes a width after
// imageView2/2/w/, and {size} is where the app puts one.
function image(url) {
  if (!url) return "";
  const u = String(url).trim().replace(/^http:/, "https:");
  if (u.indexOf("dmhmusic.com") < 0) return u;
  const base = u.split("?")[0];
  return `${base}?imageView2/2/w/{size}`;
}

function artistList(x) {
  const list = Array.isArray(x.artist) ? x.artist : x.artist ? [x.artist] : [];
  const out = list
    .map((a) => ({ id: String(a.artistCode || ""), name: htmlDecode(a.name || "") }))
    .filter((a) => a.name);
  return out.length ? out : [{ name: t("Unknown artist") }];
}

// ---------------------------------------------------------------- shapes

function toTrack(x) {
  const id = String(x.assetId || x.id || x.TSID || "");
  if (!id) return null;
  const name = htmlDecode(x.title || "");
  if (!name) return null;
  return {
    id,
    name,
    artists: artistList(x),
    duration: ms(x.duration),
    // pay_model 3 is the paid / VIP catalogue: Qianqian answers with a format
    // and a bitrate but no play url, with or without an account.
    unavailable: Number(x.pay_model) === 3 || x.available === false,
    album: x.albumAssetCode
      ? {
          id: String(x.albumAssetCode),
          name: htmlDecode(x.albumTitle || ""),
          imageUrl: image(x.pic),
        }
      : undefined,
  };
}

function toAlbum(x) {
  const id = String(x.albumAssetCode || "");
  if (!id) return null;
  return {
    id,
    name: htmlDecode(x.title || ""),
    imageUrl: image(x.pic),
    artists: artistList(x),
    released: String(x.releaseDate || "").slice(0, 10),
    saved: savedAlbumsNow().some((a) => a.id === id),
  };
}

function toArtist(x) {
  const id = String(x.artistCode || "");
  if (!id) return null;
  return {
    id,
    name: htmlDecode(x.name || ""),
    imageUrl: image(x.pic),
    following: followingNow().includes(id),
  };
}

function toPlaylist(x) {
  const id = String(x.id || "");
  if (!id) return null;
  return {
    id,
    name: htmlDecode(x.title || ""),
    imageUrl: image(x.pic),
    description: htmlDecode(x.desc || ""),
    trackCount: Number(x.trackCount || 0),
    saved: savedPlaylistsNow().some((p) => p.id === id),
  };
}

// ---------------------------------------------------------------- search

async function findTracks(query, offset) {
  const pageNo = Math.floor(Number(offset || 0) / PAGE) + 1;
  const d = await once(() => api("/v1/search", { word: query, pageNo, pageSize: PAGE }), 2);
  const items = (d.typeTrack || []).map(toTrack).filter(Boolean);
  return { items, more: items.length === PAGE };
}

async function findAlbums(query, offset) {
  const pageNo = Math.floor(Number(offset || 0) / PAGE) + 1;
  const d = await once(() => api("/v1/search", { word: query, pageNo, pageSize: PAGE }), 2);
  const items = (d.typeAlbum || []).map(toAlbum).filter(Boolean);
  return { items, more: items.length === PAGE };
}

async function findArtists(query, offset) {
  const pageNo = Math.floor(Number(offset || 0) / PAGE) + 1;
  const d = await once(() => api("/v1/search", { word: query, pageNo, pageSize: PAGE }), 2);
  const items = (d.typeArtist || []).map(toArtist).filter(Boolean);
  return { items, more: items.length === PAGE };
}

export async function search({ query, kind, offset = 0 }) {
  const q = String(query || "").trim();
  if (!q) return { [kind]: [], more: false };
  if (kind === "albums") {
    const r = await findAlbums(q, offset);
    return { albums: r.items, more: r.more };
  }
  if (kind === "artists") {
    const r = await findArtists(q, offset);
    return { artists: r.items, more: r.more };
  }
  if (kind === "tracks") {
    const r = await findTracks(q, offset);
    remember(r.items);
    return { tracks: r.items, more: r.more };
  }
  // Search has no playlist kind; the page lists them instead.
  return { [kind]: [], more: false };
}

export async function suggest({ query }) {
  const q = String(query || "").trim();
  if (!q) return [];
  const hits = await findTracks(q, 0).catch(() => ({ items: [] }));
  return hits.items.slice(0, 8).map((x) => x.name);
}

// ---------------------------------------------------------------- index

// /v1/index gives the home blocks: songs, new albums, artists, playlists.
async function blocks(pageSize) {
  const d = await api("/v1/index", { pageSize: pageSize || 12 });
  const list = Array.isArray(d) ? d : [d];
  const out = {};
  for (const b of list) {
    if (b && b.type) out[b.type] = b.result || [];
  }
  return out;
}

export async function home() {
  const [idx, lists] = await Promise.all([blocks(12).catch(() => ({})), playlistsPage(1, 10).catch(() => [])]);
  const songs = (idx.song || []).map(toTrack).filter(Boolean);
  const albums = (idx.album || []).map(toAlbum).filter(Boolean);
  const artists = (idx.artist || []).map(toArtist).filter(Boolean);
  remember(songs);

  return {
    title: t("Qianqian Music"),
    subtitle: t("Songs, playlists and albums from Qianqian"),
    sections: [
      {
        title: t("Today's songs"),
        tracks: songs,
        pageTitle: t("Today's songs"),
        morePage: "new",
        empty: t("Qianqian did not answer"),
      },
      {
        title: t("Playlists"),
        playlists: lists,
        morePage: "playlists",
      },
      {
        title: t("New albums"),
        albums,
        morePage: "albums",
      },
      {
        title: t("Artists"),
        links: artists.slice(0, 10).map((a) => ({ title: a.name, subtitle: "", imageUrl: a.imageUrl, page: `artist:${a.id}` })),
        morePage: "artists",
      },
    ],
  };
}

async function playlistsPage(pageNo, pageSize) {
  const d = await api("/v1/tracklist/list", { pageNo: pageNo || 1, pageSize: pageSize || 40 });
  return (d.result || []).map(toPlaylist).filter(Boolean);
}

export async function browse({ page }) {
  const p = String(page || "");
  if (p === "new") {
    const idx = await blocks(30);
    const songs = (idx.song || []).map(toTrack).filter(Boolean);
    remember(songs);
    return { title: t("Today's songs"), sections: [{ tracks: songs, empty: t("Nothing found") }] };
  }
  if (p === "playlists") {
    const lists = await playlistsPage(1, 40);
    return { title: t("Playlists"), sections: [{ playlists: lists, empty: t("Nothing found") }] };
  }
  if (p === "albums") {
    const idx = await blocks(30);
    const albums = (idx.album || []).map(toAlbum).filter(Boolean);
    return { title: t("New albums"), sections: [{ albums, empty: t("Nothing found") }] };
  }
  if (p === "artists") {
    const d = await api("/v1/artist/list", { pageNo: 1, pageSize: 40 });
    const artists = ((d && d.result) || []).map(toArtist).filter(Boolean);
    return { title: t("Artists"), sections: [{ artists, empty: t("Nothing found") }] };
  }
  if (p.indexOf("search:") === 0) {
    const q = p.slice(7).trim();
    if (!q) throw fail("unavailable", t("No such page"));
    const [tracks, albums, artists] = await Promise.all([
      findTracks(q, 0).catch(() => ({ items: [] })),
      findAlbums(q, 0).catch(() => ({ items: [] })),
      findArtists(q, 0).catch(() => ({ items: [] })),
    ]);
    remember(tracks.items);
    return {
      title: q,
      sections: [
        { title: t("Songs"), tracks: tracks.items, empty: t("Nothing found") },
        { title: t("Albums"), albums: albums.items },
        { title: t("Artists"), artists: artists.items },
      ],
    };
  }
  throw fail("unavailable", t("No such page"));
}

// ---------------------------------------------------------------- albums & artists

export async function album({ id }) {
  if (!id) throw fail("unavailable", t("No such album"));
  const d = await api("/v1/album/info", { albumAssetCode: id });
  if (!d || !d.albumAssetCode) throw fail("unavailable", t("No such album"));
  const tracks = (d.trackList || []).map(toTrack).filter(Boolean);
  remember(tracks);
  return {
    album: {
      id: String(id),
      name: htmlDecode(d.title || ""),
      imageUrl: image(d.pic),
      artists: artistList(d),
      released: String(d.releaseDate || "").slice(0, 10),
      description: htmlDecode(d.introduce || ""),
      saved: savedAlbumsNow().some((a) => a.id === String(id)),
    },
    tracks,
  };
}

export async function artist({ id }) {
  if (!id) throw fail("unavailable", t("No such artist"));
  const info = await api("/v1/artist/info", { artistCode: id }).catch(() => null);
  if (!info || String(info.artistCode || "") !== String(id)) throw fail("unavailable", t("No such artist"));

  const [songs, albums] = await Promise.all([
    api("/v1/artist/song", { artistCode: id, pageNo: 1, pageSize: PAGE }).catch(() => ({})),
    api("/v1/artist/albumlist", { artistCode: id, pageNo: 1, pageSize: PAGE }).catch(() => ({})),
  ]);
  const tracks = (songs.result || []).map(toTrack).filter(Boolean);
  remember(tracks);

  return {
    artist: {
      id: String(id),
      name: htmlDecode(info.name || ""),
      imageUrl: image(info.pic),
      description: htmlDecode(info.introduce || ""),
      following: followingNow().includes(String(id)),
    },
    tracks,
    albums: (albums.result || []).map(toAlbum).filter(Boolean),
  };
}

// ---------------------------------------------------------------- playlists

export async function playlist({ id }) {
  if (!id) throw fail("unavailable", t("No such playlist"));
  const d = await api("/v1/tracklist/info", { id, pageNo: 1, pageSize: 50 }).catch(() => null);
  if (!d || !d.trackList) throw fail("unavailable", t("No such playlist"));
  const tracks = (d.trackList || []).map(toTrack).filter(Boolean);
  remember(tracks);
  return {
    id: String(id),
    name: htmlDecode(d.title || ""),
    imageUrl: image(d.pic),
    description: htmlDecode(d.desc || ""),
    trackCount: Number(d.trackCount || tracks.length),
    saved: savedPlaylistsNow().some((p) => p.id === String(id)),
    tracks,
  };
}

export async function playlists() {
  return savedPlaylistsNow();
}

export async function savePlaylist({ id, on }) {
  if (!id) return;
  const all = savedPlaylistsNow().filter((p) => p.id !== String(id));
  if (on) {
    const meta = await playlist({ id }).catch(() => null);
    if (meta) all.unshift({ id: meta.id, name: meta.name, imageUrl: meta.imageUrl, trackCount: meta.trackCount });
  }
  save("playlists", all);
}

// ---------------------------------------------------------------- lyrics

export async function lyrics({ id }) {
  const d = await api("/v1/song/info", { TSID: id }).catch(() => null);
  const url = ((Array.isArray(d) ? d[0] : d) || {}).lyric;
  if (!url) return {};
  const body = await text(url).catch(() => "");
  if (!body || body.indexOf("[") < 0) return {};
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\[[0-9]+:[0-9]+/.test(line) && line.replace(/\[[^\]]+\]/g, "").trim());
  if (!lines.length) return {};
  return { lrc: lines.join("\n") };
}

// ---------------------------------------------------------------- audio

// 128 kbps, 320 kbps, or FLAC. The served format decides the type.
const RATES = { flac: 3000, "3000": 3000, "320": 320, "128": 128 };

export async function stream({ id, quality }) {
  const asked = RATES[String(quality || "").toLowerCase()] || RATES[String(host.setting("quality") || "").toLowerCase()] || 3000;
  const d = await api("/v1/song/tracklink", { TSID: id, rate: asked }).catch(() => null);
  const data = (d && (Array.isArray(d) ? d[0] : d)) || null;
  if (!data || !data.path) throw fail("unavailable", t("This song can't be played on Qianqian"));
  const url = String(data.path).replace(/^http:/, "https:");
  const fmt = String(data.format || "mp3").toLowerCase();
  return { url, type: fmt === "flac" ? "flac" : fmt === "aac" ? "aac" : "mp3" };
}

// ---------------------------------------------------------------- library

const load = (k, v) => {
  try {
    const got = host.storage.get(k);
    return got == null ? v : got;
  } catch {
    return v;
  }
};
const save = (k, v) => {
  try {
    host.storage.set(k, v);
  } catch {}
};

const cached = () => load("tracks", {});
const remember = (tracks) => {
  if (!tracks || !tracks.length) return;
  const all = cached();
  for (const tr of tracks) if (tr && tr.id) all[tr.id] = tr;
  const keys = Object.keys(all);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete all[k];
  save("tracks", all);
};
const trackById = (id) => cached()[String(id)] || null;

const likedNow = () => load("liked", []);
const savedAlbumsNow = () => load("albums", []);
const savedPlaylistsNow = () => load("playlists", []);
const followingNow = () => load("following", []);

export async function recent() {
  return load("recent", []);
}

export async function played({ id }) {
  const tr = trackById(id);
  if (!tr) return;
  const list = load("recent", []).filter((x) => x.id !== tr.id);
  list.unshift(tr);
  save("recent", list.slice(0, 50));
}

export async function liked({ offset = 0 } = {}) {
  return { tracks: load("liked", []), more: false };
}

export async function isLiked({ ids }) {
  const set = new Set(load("liked", []).map((x) => x.id));
  const out = {};
  for (const id of ids || []) out[id] = set.has(String(id));
  return out;
}

export async function like({ id, on }) {
  const all = likedNow().filter((x) => x.id !== String(id));
  if (on) {
    const tr = trackById(id);
    if (tr) all.unshift(tr);
  }
  save("liked", all);
}

export async function savedAlbums({ offset = 0 } = {}) {
  return { albums: savedAlbumsNow(), more: false };
}

export async function saveAlbum({ id, on }) {
  if (!id) return;
  const all = savedAlbumsNow().filter((x) => x.id !== String(id));
  if (on) {
    const r = await album({ id }).catch(() => null);
    if (r) all.unshift({ ...r.album, description: undefined });
  }
  save("albums", all);
}

export async function followArtist({ id, on }) {
  if (!id) return;
  const all = followingNow().filter((x) => x !== String(id));
  if (on) all.push(String(id));
  save("following", all);
}

// ---------------------------------------------------------------- stations

// A station is a way into the catalogue: today's songs, or a playlist picked
// from the list each time.
export async function stations() {
  return [
    { id: "new", name: t("Today's songs"), description: t("Picked by Qianqian") },
    { id: "playlists", name: t("Playlists"), description: t("A playlist from the list") },
  ];
}

export async function stationNext({ id }) {
  if (String(id) === "playlists") {
    const lists = await playlistsPage(1 + Math.floor(Math.random() * 5), 20).catch(() => []);
    const pick = lists[Math.floor(Math.random() * lists.length)];
    if (!pick) return [];
    const r = await playlist({ id: pick.id }).catch(() => ({ tracks: [] }));
    return r.tracks.slice(0, 30);
  }
  const idx = await blocks(30).catch(() => ({}));
  const songs = (idx.song || []).map(toTrack).filter(Boolean);
  remember(songs);
  return songs;
}
