# Guestlist Release

The redesigned Spotify Guestlist Generator. This is a separate React/Vite application; `OG` and `Figma MAKE Source Code` are not used or modified at runtime.

## Run locally

1. Create a Spotify app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add `http://127.0.0.1:5173/` as a Redirect URI. Add the final production URL there before deploying.
3. Copy `.env.example` to `.env` and add the app's client ID:

   ```bash
   VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
   ```

4. Install and run:

   ```bash
   pnpm install
   pnpm dev
   ```

## What it does

- Uses Spotify OAuth with PKCE; tokens stay in the listener's browser storage.
- Uses `user-top-read` only to personalize the landing-page marquee after authorization.
- Requires an artist picker for every non-exact artist-name match, preventing silent substitutions such as returning j-hope for BTS/SUGA/RM.
- Converts non-JSON Spotify responses into readable errors instead of attempting to parse them as JSON.
- Finds and deduplicates potential credited feature tracks, lets listeners curate the list, then creates a private Spotify playlist.

## Before release

Test the full flow with a fresh Spotify account and a representative set of artists, especially aliases and artists with duplicate names. Spotify catalog search and `appears_on` metadata are useful but are not a guarantee of every historical collaboration.
