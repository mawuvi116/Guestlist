import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  SpotifyArtist, GuestTrack, beginLogin, createPlaylist, exactArtist, finishLogin,
  getTopArtists, hasSession, isConfigured, logout, scanFeatures, searchArtists,
} from "./lib/spotify";

type Status = { title: string; text: string; progress?: number; tone?: "error" | "success" } | null;
type Sort = "popularity" | "newest" | "oldest" | "name";

const fallbackTicker = ["SZA", "Tems", "Wizkid", "Kendrick Lamar", "Rihanna", "Lecrae", "Miles Minnick", "Mariah The Scientist"];

export default function App() {
  const [connected, setConnected] = useState(hasSession());
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<SpotifyArtist[]>([]);
  const [artist, setArtist] = useState<SpotifyArtist | null>(null);
  const [tracks, setTracks] = useState<GuestTrack[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [topArtists, setTopArtists] = useState<SpotifyArtist[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [working, setWorking] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("popularity");
  const [playlistUrl, setPlaylistUrl] = useState<string | undefined>();

  useEffect(() => {
    finishLogin().then(async (result) => {
      setConnected(result.connected);
      if (result.error) setStatus({ title: "Spotify sign-in didn’t complete", text: result.error, tone: "error" });
      if (result.connected) setTopArtists(await getTopArtists());
    });
  }, []);

  const marqueeNames = topArtists.length ? topArtists.map(({ name }) => name) : fallbackTicker;
  const visibleTracks = useMemo(() => {
    const search = filter.trim().toLowerCase();
    return [...tracks]
      .filter((track) => !search || [track.name, track.album, track.releaseYear, ...track.artists.map((a) => a.name), ...track.reasons].join(" ").toLowerCase().includes(search))
      .sort((a, b) => sort === "newest" ? b.releaseYear - a.releaseYear || b.popularity - a.popularity : sort === "oldest" ? a.releaseYear - b.releaseYear || b.popularity - a.popularity : sort === "name" ? a.name.localeCompare(b.name) : b.popularity - a.popularity || b.releaseYear - a.releaseYear);
  }, [filter, sort, tracks]);

  async function connect() {
    if (!isConfigured()) {
      setStatus({ title: "Spotify connection unavailable", text: "Guestlist can’t connect to Spotify right now. Please try again shortly.", tone: "error" });
      return;
    }
    try { await beginLogin(); }
    catch (error) { setStatus({ title: "Connection unavailable", text: errorMessage(error), tone: "error" }); }
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (!connected) { await connect(); return; }
    const name = query.trim();
    if (!name) return;
    setWorking(true); setCandidates([]); setArtist(null); setTracks([]); setSelected(new Set()); setPlaylistUrl(undefined);
    setStatus({ title: "Resolving artist", text: `Looking up “${name}” on Spotify…`, progress: 8 });
    try {
      const found = await searchArtists(name);
      if (!found.length) { setStatus({ title: "Artist not found", text: `Spotify did not return an artist for “${name}”. Try their exact Spotify name.`, tone: "error" }); return; }
      const exact = exactArtist(name, found);
      if (exact) await startScan(exact);
      else { setCandidates(found); setStatus({ title: "Choose the artist", text: `Several Spotify artists could match “${name}”. Select the right profile before scanning.`, progress: 100 }); }
    } catch (error) { setStatus({ title: "Search interrupted", text: errorMessage(error), tone: "error" }); }
    finally { setWorking(false); }
  }

  async function startScan(nextArtist: SpotifyArtist) {
    setWorking(true); setCandidates([]); setArtist(nextArtist); setTracks([]); setSelected(new Set()); setPlaylistUrl(undefined);
    try {
      const found = await scanFeatures(nextArtist, (done, total, text) => setStatus({ title: "Scanning Spotify", text, progress: Math.round((done / total) * 100) }));
      setTracks(found); setSelected(new Set(found.map((track) => track.id)));
      setStatus(found.length ? { title: "Scan complete", text: `Found ${found.length} possible guest appearances. Review the list before saving.`, progress: 100, tone: "success" } : { title: "No feature tracks found", text: "Try another spelling or artist profile. Spotify’s catalog metadata can be incomplete.", progress: 100 });
    } catch (error) { setStatus({ title: "Scan interrupted", text: errorMessage(error), tone: "error" }); }
    finally { setWorking(false); }
  }

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleVisible() {
    const allSelected = visibleTracks.length > 0 && visibleTracks.every((track) => selected.has(track.id));
    setSelected((current) => { const next = new Set(current); visibleTracks.forEach((track) => allSelected ? next.delete(track.id) : next.add(track.id)); return next; });
  }
  async function savePlaylist() {
    if (!artist) return;
    const chosen = tracks.filter((track) => selected.has(track.id));
    if (!chosen.length) { setStatus({ title: "Nothing selected", text: "Choose at least one track before creating a playlist.", tone: "error" }); return; }
    setWorking(true);
    try {
      const url = await createPlaylist(artist, chosen, (saved, total) => setStatus({ title: "Creating playlist", text: `Saved ${saved} of ${total} tracks to Spotify…`, progress: Math.round((saved / total) * 100) }));
      setPlaylistUrl(url); setStatus({ title: "Playlist ready", text: `Your ${artist.name} Guestlist is now in Spotify.`, progress: 100, tone: "success" });
    } catch (error) { setStatus({ title: "Playlist wasn’t created", text: errorMessage(error), tone: "error" }); }
    finally { setWorking(false); }
  }
  function disconnect() { logout(); setConnected(false); setTopArtists([]); setArtist(null); setTracks([]); setSelected(new Set()); setCandidates([]); setStatus(null); setPlaylistUrl(undefined); }

  return <div className="site-shell">
    <nav className="nav"><a className="brand" href="#top">Guestlist <span>beta</span></a><div className="nav-links"><a href="#how">How it works</a>{connected && <button onClick={disconnect}>Disconnect Spotify</button>}</div></nav>
    <main id="top">
      <section className="hero">
        <div className="vinyl vinyl-one" /><div className="vinyl vinyl-two" /><div className="grid-noise" />
        <div className="hero-content">
          <p className="kicker">— Spotify feature discovery</p>
          <h1>Find every<br /><em>feature.</em></h1>
          <p className="hero-copy">Your favourite artists have probably appeared on more songs than you know. Guestlist digs through their credited collaborations so you can discover the tracks hiding in plain sight.</p>
          <form className="hero-search" onSubmit={submitSearch}>
            <label className="sr-only" htmlFor="artist-search">Artist name</label>
            <input id="artist-search" value={query} onChange={(event) => setQuery(event.target.value)} disabled={working} placeholder="Search an artist… try Tems" autoComplete="off" />
            <button type="submit" disabled={working}>{working ? "Working…" : connected ? "Search Guestlist" : "Connect Spotify to continue"}</button>
          </form>
          <div className="hero-guide"><strong>Search. Discover. Review. Save.</strong><span>Search an artist → discover their credited features → choose your picks → save a private Spotify playlist.</span></div>
          <div className="hero-notes"><span>Some obvious</span><span>Some obscure</span><span>The ones you’ll keep</span><span>The ones you’ll flex</span></div>
        </div>
      </section>

      <div className="ticker" aria-label={connected && topArtists.length ? "Your top Spotify artists" : "Featured artists"}><div className="ticker-track">{[...marqueeNames, ...marqueeNames].map((name, index) => <span key={`${name}-${index}`}>{name}<b>✦</b></span>)}</div></div>

      {status && <section className={`status-card ${status.tone ?? ""}`} aria-live="polite"><div><p className="kicker">— {status.title}</p><p>{status.text}</p></div>{typeof status.progress === "number" && <div className="progress"><i style={{ width: `${status.progress}%` }} /></div>}</section>}

      {candidates.length > 0 && <section className="workspace picker"><div className="section-title"><p className="kicker">— Pick the right profile</p><h2>Which artist did you mean?</h2><p>We never guess a non-exact Spotify artist match.</p></div><div className="artist-options">{candidates.map((candidate) => <button className="artist-option" onClick={() => startScan(candidate)} disabled={working} key={candidate.id}><ArtistImage artist={candidate} /><span><strong>{candidate.name}</strong><small>{artistDetails(candidate)}</small></span><b>Scan →</b></button>)}</div></section>}

      {artist && !candidates.length && <section className="workspace results-workspace">
        <div className="results-header"><div className="artist-ident"><ArtistImage artist={artist} /><div><p className="kicker">— Guestlist scan</p><h2>{artist.name}<br /><em>features</em></h2><p>{artistDetails(artist) || "Spotify artist"}</p></div></div><div className="result-stat"><strong>{tracks.length}</strong><span>possible features</span></div></div>
        {tracks.length > 0 && <><div className="toolbar"><p><b>{tracks.length} tracks</b><span>{selected.size} selected</span></p><div className="controls"><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="popularity">Most popular</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name">Track name</option></select></label><label>Filter<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Track, collaborator, album…" /></label></div><div className="toolbar-actions"><button className="secondary" type="button" onClick={toggleVisible}>{visibleTracks.length && visibleTracks.every((track) => selected.has(track.id)) ? "Deselect shown" : "Select shown"}</button><button className="primary" type="button" onClick={savePlaylist} disabled={working || !selected.size}>Create playlist <span>→</span></button></div></div>
        <div className="track-table"><div className="track-labels"><span>#</span><span>Title / artist</span><span>Popularity</span></div>{visibleTracks.map((track, index) => <TrackRow key={track.id} track={track} number={index + 1} checked={selected.has(track.id)} onToggle={() => toggle(track.id)} />)}{!visibleTracks.length && <p className="no-results">No tracks match that filter.</p>}</div></>}
        {playlistUrl && <a className="playlist-link" href={playlistUrl} target="_blank" rel="noreferrer">Open your playlist in Spotify ↗</a>}
      </section>}

      <section id="how" className="how"><div className="section-title"><p className="kicker">— How it works</p><h2>Three steps to<br /><em>every collab.</em></h2></div><div className="steps"><Step number="01" title="Search any artist" body="Enter a name and we resolve the correct Spotify artist profile before scanning." /><Step number="02" title="Review the matches" body="Inspect results, filter and sort them, then keep only the appearances you want." /><Step number="03" title="Save your Guestlist" body="Create a private Spotify playlist with your selected tracks in one click." /></div></section>
      <section className="closing"><p className="kicker">— Your next discovery starts here</p><h2>Every feature.<br /><em>Every artist.</em></h2><button className="primary closing-button" onClick={() => document.getElementById("artist-search")?.focus()}>{connected ? "Search another artist" : "Connect Spotify to begin"}</button></section>
    </main>
    <footer><span className="brand">Guestlist</span><span>© {new Date().getFullYear()} · Built for better listening.</span><span>Not affiliated with Spotify.</span></footer>
  </div>;
}

function ArtistImage({ artist }: { artist: SpotifyArtist }) { const image = artist.images?.at(-1)?.url ?? artist.images?.[0]?.url; return image ? <img className="artist-image" src={image} alt="" /> : <div className="artist-image placeholder">♪</div>; }
function TrackRow({ track, number, checked, onToggle }: { track: GuestTrack; number: number; checked: boolean; onToggle: () => void }) { return <article className="track-row"><label><input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${track.name}`} /><span>{String(number).padStart(2, "0")}</span></label>{track.image ? <img src={track.image} alt="" /> : <div className="track-art placeholder">♪</div>}<div className="track-detail"><h3>{track.name}{track.explicit && <i title="Explicit">E</i>}</h3><p>{track.artists.map((artist) => artist.name).join(", ")}</p><small>{track.album} · {track.releaseYear || "—"}</small><div>{track.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div></div><div className="popularity"><strong>{track.popularity}</strong><span>popularity</span>{track.url && <a href={track.url} target="_blank" rel="noreferrer">Open ↗</a>}</div></article>; }
function Step({ number, title, body }: { number: string; title: string; body: string }) { return <article><b>{number}</b><h3>{title}</h3><p>{body}</p></article>; }
function artistDetails(artist: SpotifyArtist) { return [artist.followers?.total ? `${artist.followers.total.toLocaleString()} followers` : "", artist.genres?.slice(0, 2).join(" · ") ?? ""].filter(Boolean).join(" · "); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Spotify did not complete that request."; }
