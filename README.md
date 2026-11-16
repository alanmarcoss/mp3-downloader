# Wavelength — YouTube & SoundCloud MP3 Downloader

A **Nuxt 3 + shadcn-vue** web app designed for **Vercel** custom subdomain hosting that converts **YouTube** and **SoundCloud** tracks into high-bitrate MP3s with embedded cover art and **24-hour caching**.

---

## Architecture & Infrastructure

### Stack
- **Frontend**: Nuxt 3, Vue 3, Tailwind CSS, `shadcn-vue` (`reka-ui`), `@nuxtjs/color-mode`, `@vueuse/core`.
- **Server Runtime**: Nitro Serverless Functions on Vercel (`maxDuration: 60s`, `memory: 1024 MB`, uncompressed bundle ~59 MB including `ffmpeg-static`).
- **Audio Transcoding & Tagging**: `ffmpeg-static` (`libmp3lame` at `128` / `192` / `320 kbps`, 44.1 kHz) with embedded **ID3v2.3** `Title`, `Artist`, and scaled `MJPEG` front cover art (`APIC`).
- **Object Storage / CDN**: `@vercel/blob` (with automatic local `.data/cache/` disk fallback in local dev and `/tmp/wavelength-cache/` fallback on serverless if `BLOB_READ_WRITE_TOKEN` is not yet configured).

### Extraction Pipeline
- **YouTube (`server/utils/youtube.ts`)**:
  1. `@distube/ytdl-core` (with optional `YOUTUBE_COOKIES` and `YOUTUBE_PROXY` agent support).
  2. `youtubei.js` Innertube multi-client fallback (`IOS`, `ANDROID`, `YTMUSIC`, `TV_EMBEDDED`).
  3. Optional local `yt-dlp` binary fallback when running in local dev or Docker.
  4. Fast oEmbed fallback (`/oembed`) for instant metadata previews when rate-limited.
- **SoundCloud (`server/utils/soundcloud.ts`)**:
  - Automatic `client_id` discovery and caching from SoundCloud's web JS bundles (`a-v2.sndcdn.com/assets/*.js`) with auto-refresh on `401`/`403`.
  - Shortlink expansion (`on.soundcloud.com`, `snd.sc`) and private secret-token (`/s-xxxxx`) preservation.
  - Ranked transcoding fallback across progressive MP3 and HLS (`aac_160k` fMP4 `#EXT-X-MAP` + `.m4s` segment assembly, MP3 HLS, Opus) with `track_authorization` support.

### 24-Hour Cache Strategy
1. **Bypasses Vercel's 4.5 MB HTTP Payload Limit**: Serverless functions transcode in `/tmp` and upload directly to **Vercel Blob** (`tracks/<cacheKey>/`), serving inline audio previews (`streamUrl`) and file downloads (`?download=1`) directly from Vercel's global CDN.
2. **Canonical Deduplication**: Different URL forms for the same track + bitrate resolve to one deterministic cache key (`yt-<videoId>-<bitrate>` or `sc-<sha256(canonicalUrl)>-<bitrate>`). Repeat requests within 24 hours return an instant cache hit without re-downloading or re-transcoding, and concurrent identical requests share a single in-flight promise.
3. **Triple-Layer 24h Expiration**:
   - **Read-time TTL check**: Entries with `Date.now() >= expiresAt` are rejected and deleted immediately on lookup.
   - **Opportunistic background prune**: `/api/extract` schedules `event.waitUntil(cleanupExpiredTracks())` non-blockingly after conversions.
   - **Daily Vercel Cron (`/api/cron/cleanup`)**: Configured at `0 4 * * *` in `vercel.json` (compatible with both **Vercel Hobby** and **Pro** plans) and protected by `Authorization: Bearer <CRON_SECRET>`.

---

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. When `BLOB_READ_WRITE_TOKEN` is unset locally, `.data/cache/tracks/` is used automatically with HTTP `Range` streaming support via `/api/files/[key]`.

### Testing & Type Checking

```bash
npm test            # Run Vitest unit & integration suite
npm run test:watch  # Watch mode
npm run typecheck   # TypeScript verification
```

---

## Deploying to Vercel + Custom Subdomain

1. **Import Repository into Vercel**
   - Import the GitHub repository into [Vercel](https://vercel.com/new) (Framework Preset: **Nuxt.js**).

2. **Attach Vercel Blob Storage**
   - In your Vercel project dashboard, go to **Storage → Create Database → Blob** (Public store) and connect it to the project. Vercel automatically injects `BLOB_READ_WRITE_TOKEN`.

3. **Environment Variables (`.env.example`)**
   - `BLOB_READ_WRITE_TOKEN`: Auto-populated by Vercel Blob.
   - `CRON_SECRET`: Random secret string verified by `/api/cron/cleanup`.
   - `CACHE_TTL_HOURS`: Defaults to `24`.
   - `MAX_DURATION_SECONDS`: Defaults to `3600` (60 minutes).
   - `YOUTUBE_COOKIES` / `YOUTUBE_PROXY` *(optional)*: Browser cookies (JSON array or raw `Cookie` header) or proxy URL if Vercel datacenter IPs hit YouTube bot checks.
   - `SOUNDCLOUD_CLIENT_ID` *(optional)*: Overrides automatic `client_id` discovery.

4. **Custom Subdomain Setup**
   - Add your subdomain (e.g. `mp3.yourdomain.com`) under **Project Settings → Domains** in Vercel.
   - Add a `CNAME` DNS record for your subdomain pointing to `cname.vercel-dns.com`.
