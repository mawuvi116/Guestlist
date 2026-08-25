export type SpotifyArtist = {
  id: string;
  name: string;
  images?: { url: string }[];
  followers?: { total: number };
  genres?: string[];
  popularity?: number;
  external_urls?: { spotify?: string };
};

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album?: { name?: string; release_date?: string; images?: { url: string }[] };
  popularity?: number;
  explicit?: boolean;
  external_urls?: { spotify?: string };
  external_ids?: { isrc?: string };
};

export type GuestTrack = {
  id: string;
  uri: string;
  name: string;
  artists: SpotifyArtist[];
  album: string;
  releaseYear: number;
  image: string;
  popularity: number;
  explicit: boolean;
  url: string;
  reasons: string[];
  duplicateKey: string;
};

export type Tokens = { access_token: string; refresh_token?: string; expires_at: number };

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
const REDIRECT_URI = window.location.origin + window.location.pathname;
const TOKEN_KEY = "guestlist.spotify.tokens";
const VERIFIER_KEY = "guestlist.spotify.verifier";
const SCOPES = ["playlist-modify-private", "playlist-modify-public", "user-top-read"].join(" ");

export function isConfigured() {
  return Boolean(CLIENT_ID);
}

export async function beginLogin() {
  if (!CLIENT_ID) throw new Error("Spotify is not configured yet. Add VITE_SPOTIFY_CLIENT_ID to .env.");
  const verifier = randomString(96);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await codeChallenge(verifier);
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, scope: SCOPES, redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256", code_challenge: challenge,
  }).toString();
  window.location.assign(url.toString());
}

export async function finishLogin(): Promise<{ connected: boolean; error?: string }> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const denied = params.get("error");
  if (!code && !denied) return { connected: Boolean(getTokens()?.access_token) };
  cleanUrl();
  if (denied) return { connected: false, error: denied };
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier || !CLIENT_ID) return { connected: false, error: "Could not finish Spotify sign-in. Please try connecting again." };
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "authorization_code", code: code!, redirect_uri: REDIRECT_URI, code_verifier: verifier }).toString(),
    });
    const data = await responseData(response);
    if (!response.ok) throw new Error(data.error_description || "Spotify rejected the sign-in request.");
    saveTokens(data);
    localStorage.removeItem(VERIFIER_KEY);
    return { connected: true };
  } catch (error) {
    return { connected: false, error: message(error) };
  }
}

export function logout() { localStorage.removeItem(TOKEN_KEY); }
export function hasSession() { return Boolean(getTokens()?.access_token); }

export async function searchArtists(query: string) {
  const token = await accessToken();
  const candidates = new Map<string, SpotifyArtist>();
  // A plain query and artist field query cover Spotify's differing ranking behaviour.
  for (const term of [query, `artist:${query}`]) {
    const data = await api(`/search?q=${encodeURIComponent(term)}&type=artist&limit=20`, token);
    for (const artist of data.artists?.items ?? []) candidates.set(artist.id, artist);
  }
  return [...candidates.values()].sort((a, b) => scoreArtist(query, b) - scoreArtist(query, a));
}

/** Exact names can advance; every other query must be confirmed by the listener. */
export function exactArtist(query: string, candidates: SpotifyArtist[]) {
  const normalized = canonical(query);
  const exact = candidates.filter((artist) => canonical(artist.name) === normalized);
  return exact.length ? [...exact].sort((a, b) => scoreArtist(query, b) - scoreArtist(query, a))[0] : null;
}

export async function getTopArtists() {
  try {
    const data = await api("/me/top/artists?limit=12&time_range=medium_term", await accessToken());
    return (data.items ?? []) as SpotifyArtist[];
  } catch { return []; }
}

export async function scanFeatures(artist: SpotifyArtist, update: (done: number, total: number, label: string) => void) {
  const token = await accessToken();
  const tracks = new Map<string, GuestTrack>();
  const fingerprints = new Map<string, GuestTrack>();
  const add = (raw: SpotifyTrack) => {
    const reasons = classify(raw, artist);
    if (!reasons) return;
    const track = normalize(raw, reasons);
    const duplicate = fingerprints.get(track.duplicateKey);
    if (!duplicate) { tracks.set(track.id, track); fingerprints.set(track.duplicateKey, track); return; }
    const preferred = prefer(duplicate, track);
    preferred.reasons = [...new Set([...duplicate.reasons, ...track.reasons])];
    tracks.delete(duplicate.id); tracks.delete(track.id); tracks.set(preferred.id, preferred); fingerprints.set(track.duplicateKey, preferred);
  };
  const queries = trackQueries(artist.name);
  for (let i = 0; i < queries.length; i++) {
    update(i, queries.length + 1, `Searching ${i + 1} of ${queries.length} patterns for ${artist.name}…`);
    for (let offset = 0; offset < 1000; offset += 50) {
      const data = await api(`/search?q=${encodeURIComponent(queries[i])}&type=track&limit=50&offset=${offset}`, token);
      const items = (data.tracks?.items ?? []) as SpotifyTrack[];
      items.forEach(add);
      if (items.length < 50) break;
    }
  }
  update(queries.length, queries.length + 1, `Checking ${artist.name}'s Spotify appearances…`);
  (await appearsOnTracks(artist, token)).forEach(add);
  update(queries.length + 1, queries.length + 1, `Found ${tracks.size} possible feature tracks.`);
  return [...tracks.values()];
}

export async function createPlaylist(artist: SpotifyArtist, tracks: GuestTrack[], update: (saved: number, total: number) => void) {
  const token = await accessToken();
  const me = await api("/me", token);
  const playlist = await api(`/users/${me.id}/playlists`, token, { method: "POST", body: JSON.stringify({ name: `${artist.name} — Guestlist`, public: false, description: "Guest appearances found with Guestlist." }) });
  for (let start = 0; start < tracks.length; start += 100) {
    const chunk = tracks.slice(start, start + 100);
    await api(`/playlists/${playlist.id}/tracks`, token, { method: "POST", body: JSON.stringify({ uris: chunk.map((track) => track.uri) }) });
    update(Math.min(start + chunk.length, tracks.length), tracks.length);
  }
  return playlist.external_urls?.spotify as string | undefined;
}

async function appearsOnTracks(artist: SpotifyArtist, token: string) {
  const albumIds: string[] = [];
  for (let offset = 0; offset < 150; offset += 50) {
    const data = await api(`/artists/${artist.id}/albums?include_groups=appears_on&limit=50&offset=${offset}`, token);
    const items = data.items ?? [];
    albumIds.push(...items.map((album: { id: string }) => album.id));
    if (items.length < 50) break;
  }
  const trackIds: string[] = [];
  for (const id of [...new Set(albumIds)].slice(0, 120)) {
    const data = await api(`/albums/${id}/tracks?limit=50`, token);
    trackIds.push(...(data.items ?? []).map((track: { id: string }) => track.id).filter(Boolean));
  }
  const tracks: SpotifyTrack[] = [];
  for (let i = 0; i < trackIds.length && i < 500; i += 50) {
    const data = await api(`/tracks?ids=${trackIds.slice(i, i + 50).join(",")}`, token);
    tracks.push(...(data.tracks ?? []).filter(Boolean));
  }
  return tracks;
}

function classify(track: SpotifyTrack, artist: SpotifyArtist) {
  const target = artist.name.toLowerCase(); const names = track.artists.map((a) => a.name.toLowerCase()); const ids = track.artists.map((a) => a.id);
  const credited = ids.includes(artist.id) || names.includes(target); const title = mentions(track.name, target); const album = mentions(track.album?.name ?? "", target);
  if (!credited && !title && !album) return null;
  const index = ids.includes(artist.id) ? ids.indexOf(artist.id) : names.indexOf(target);
  if (track.artists.length === 1 && credited) return null;
  if (index === 0 && !featureTitle(track.name, target)) return null;
  return [credited ? "credited artist" : "", title ? "title mention" : "", album ? "album mention" : ""].filter(Boolean);
}

function normalize(track: SpotifyTrack, reasons: string[]): GuestTrack {
  const releaseYear = Number.parseInt(track.album?.release_date?.slice(0, 4) ?? "", 10) || 0;
  const names = track.artists.map((artist) => canonical(artist.name)).sort().join("|");
  return { id: track.id, uri: track.uri, name: track.name, artists: track.artists, album: track.album?.name ?? "Unknown album", releaseYear, image: track.album?.images?.at(-1)?.url ?? track.album?.images?.[0]?.url ?? "", popularity: track.popularity ?? 0, explicit: Boolean(track.explicit), url: track.external_urls?.spotify ?? "", reasons, duplicateKey: track.external_ids?.isrc || `${canonicalTrack(track.name)}|${names}` };
}

function prefer(a: GuestTrack, b: GuestTrack) { return b.popularity !== a.popularity ? (b.popularity > a.popularity ? b : a) : b.releaseYear > a.releaseYear ? b : a; }
function trackQueries(name: string) { const set = new Set([name, `"${name}"`, `artist:${name}`, `artist:"${name}"`, `feat. ${name}`, `featuring ${name}`, `with ${name}`]); if (name.toLowerCase().startsWith("the ")) set.add(name.slice(4)); return [...set]; }
function featureTitle(text: string, name: string) { const escaped = escape(name); return [`\\bfeat\\.?\\s+${escaped}\\b`, `\\bft\\.?\\s+${escaped}\\b`, `\\bfeaturing\\s+${escaped}\\b`, `\\bwith\\s+${escaped}\\b`].some((pattern) => new RegExp(pattern, "i").test(text)); }
function mentions(text: string, name: string) { return featureTitle(text, name) || new RegExp(`\\b${escape(name)}\\b`, "i").test(text); }
function canonical(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the\s+/, ""); }
function canonicalTrack(value: string) { return canonical(value).replace(/\b(radio edit|single version|clean|explicit|remastered.*|sped up|slowed|nightcore)\b/g, "").trim(); }
function scoreArtist(query: string, artist: SpotifyArtist) { const a = canonical(artist.name); const q = canonical(query); return (artist.popularity ?? 0) + Math.log10((artist.followers?.total ?? 0) + 1) + (a === q ? 1000 : a.startsWith(q) ? 70 : a.includes(q) ? 35 : 0); }
function escape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function api(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
  const data = response.status === 204 ? {} : await responseData(response);
  if (!response.ok) throw new Error(data?.error?.message || data?.error_description || "Spotify request failed.");
  return data;
}
async function accessToken() {
  const tokens = getTokens(); if (!tokens?.access_token) throw new Error("Connect Spotify again to continue.");
  if (Date.now() < tokens.expires_at - 60_000) return tokens.access_token;
  if (!tokens.refresh_token || !CLIENT_ID) throw new Error("Spotify session expired. Connect again.");
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: tokens.refresh_token }).toString() });
  const data = await responseData(response); if (!response.ok) { logout(); throw new Error(data.error_description || "Spotify session expired. Connect again."); }
  saveTokens({ ...data, refresh_token: data.refresh_token || tokens.refresh_token }); return data.access_token;
}
async function responseData(response: Response): Promise<any> { const text = await response.text(); if (!text) return {}; try { return JSON.parse(text); } catch { return { error_description: text }; } }
function saveTokens(data: any) { localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 } satisfies Tokens)); }
function getTokens(): Tokens | null { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "null"); } catch { return null; } }
function cleanUrl() { window.history.replaceState({}, document.title, REDIRECT_URI); }
function randomString(length: number) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"; const bytes = crypto.getRandomValues(new Uint8Array(length)); return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join(""); }
async function codeChallenge(verifier: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)); return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong."; }
