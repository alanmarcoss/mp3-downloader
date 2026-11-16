# Wavelength — YouTube & SoundCloud MP3 Downloader

A modern **Nuxt 3 + shadcn-vue** web app built for hosting on **Vercel** (on your own subdomain) that converts **YouTube** and **SoundCloud** tracks into tagged high-bitrate MP3s with embedded cover art and **24-hour cloud caching**.

---

## Features (v1)

- **YouTube & SoundCloud Support**:
  - **YouTube**: Standard videos (`youtube.com/watch?v=...`), short links (`youtu.be/...`), YouTube Music (`music.youtube.com`), and Shorts, using a multi-tier extraction pipeline (`@distube/ytdl-core` → `youtubei.js` Innertube clients → local `yt-dlp` fallback in dev).
  - **SoundCloud**: Full track URLs, mobile share shortlinks (`on.soundcloud.com/...`), progressive MP3 streams, and HLS segment assembly with automatic `client_id` discovery.
- **Studio-Grade MP3 Output**:
  - Selectable **128 kbps**, **192 kbps**, or **320 kbps** (`libmp3lame` via `ffmpeg-static`).
  - Automatic **ID3v2.3 tags** (`Title`, `Artist`) and embedded **Front Cover Art** (`APIC`).
- **Smart 24-Hour Caching Strategy**:
  - Bypasses Vercel Serverless Functions' 4.5 MB response payload limit by storing converted MP3s directly in **Vercel Blob** (`tracks/<provider>-<id>-<bitrate>/`).
  - **Server-side URL deduplication**: Re-requesting the same track + bitrate within 24 hours returns an **instant cache hit** in ~100ms without re-downloading or re-transcoding.
  - **Triple-layer 24h expiration**:
    1. **Read-time TTL check**: Expired blobs (`>= 24h`) are ignored and purged immediately on lookup.
    2. **Opportunistic background cleanup**: Uses `event.waitUntil()` after conversions to prune expired blobs without slowing responses.
    3. **Scheduled Vercel Cron (`/api/cron/cleanup`)**: Runs daily (`0 4 * * *` in `vercel.json` — compatible with both **Vercel Hobby** and **Pro** plans) to guarantee zero orphaned files.
  - **Zero-config Local Dev Fallback**: When `BLOB_READ_WRITE_TOKEN` is unset locally, files are cached in `.data/cache/tracks/` with full HTTP `Range` streaming support.
- **Polished `shadcn-vue` Interface**:
  - Auto-detects platform badges as you paste, previews track metadata before converting, includes an inline audio scrubber preview, copies shareable 24-hour direct MP3 links, and maintains a per-browser **24-Hour Download Vault** with live expiry countdowns.

---

## Local Development

```bash
npm install
npm run dev
```

Run the automated test suite & TypeScript check:

```bash
npm test
npm run typecheck
```

Open `http://localhost:3000`. No cloud credentials are required locally — `.data/cache/` is used automatically until `BLOB_READ_WRITE_TOKEN` is set.

---

## Deploying to Vercel + Custom Subdomain

1. **Import Repository into Vercel**
   - Push this repo to GitHub/GitLab/Bitbucket and import it into [Vercel](https://vercel.com/new).
   - Framework Preset: **Nuxt.js** (auto-detected).

2. **Attach Vercel Blob Storage (1-Click)**
   - In your Vercel project dashboard, open **Storage → Create Database → Blob** (Public store).
   - Connect it to your project — Vercel automatically injects `BLOB_READ_WRITE_TOKEN`.

3. **Set Optional Environment Variables**
   - `CRON_SECRET`: Any random secret string (Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when triggering `/api/cron/cleanup`).
   - `YOUTUBE_COOKIES` / `YOUTUBE_PROXY` *(optional)*: Datacenter IPs (AWS/Vercel) can occasionally trigger YouTube's *"Sign in to confirm you're not a bot"* prompt. Providing browser cookies (JSON array from Cookie-Editor or raw `Cookie` header string) or an HTTP proxy URL resolves datacenter rate limits.

4. **Point Your Subdomain**
   - Go to **Project Settings → Domains** in Vercel and add your subdomain (e.g., `mp3.yourdomain.com`).
   - In your DNS provider, add the `CNAME` record shown by Vercel:
     - **Type**: `CNAME`
     - **Name**: `mp3` (or your chosen subdomain)
     - **Value**: `cname.vercel-dns.com`
