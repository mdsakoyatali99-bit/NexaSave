# NexaSave v4 — Professional Render-ready video saver

## Included
- Premium glassmorphism interface, polished responsive layout, glow/reflection effects.
- Local weather card using browser geolocation, city-search fallback, day/night and weather-reactive page themes.
- Direct video URL downloader through the Express backend (video content type validation).
- Local file save from the user's device.
- SSRF protections: only HTTP(S), public DNS/IP destinations, ports 80/443, pinned DNS result, redirect revalidation, 4-redirect maximum.
- 512 MB download limit, request timeout, safe filename handling.
- Render Blueprint and `/health` endpoint.

## GitHub → Render deployment
1. Extract this ZIP.
2. Upload the **contents** of the extracted folder to the root of a GitHub repository.
3. In Render select **New + → Blueprint**, connect that repository, and deploy the detected `render.yaml`.
4. Or create a Web Service manually:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`

Render supplies `PORT`; no Python server or extra environment variable is required. Node.js 18+ is required.

## Why the old URL download did not work
Previously the browser tried to download directly from a third-party host. Many hosts block browser cross-origin downloads, ignore the `download` attribute, redirect to a page, or require headers/cookies. v4 routes direct media URLs through the app backend, checks that the response is an actual video/octet-stream file, and streams it as an attachment.

## Supported URL types and limitations
Paste a **direct media file URL** that returns a video file (for example MP4, WebM, MOV, M4V, OGV). The URL does not have to end in `.mp4`; the server validates the response content type.

TikTok, YouTube and Facebook share/post URLs are web pages, not direct video-file URLs. This project does not scrape those sites, bypass DRM, defeat access controls, or circumvent platform restrictions. Use each platform's official download feature or an authorized integration for content you have permission to save.

The backend has a 512 MB limit. Some source hosts block automated server requests, require sign-in/cookies, or use unsupported streaming/protection; such links will fail and should be downloaded using the source platform's official method. Do not use the service to download copyrighted content without permission.

## Weather privacy
Location is requested by the visitor's browser. If permission is denied, city search is available. Weather is retrieved from Open-Meteo in the browser; location coordinates are not posted to the NexaSave backend.

## Local run
```bash
npm install
npm start
```
Open `http://localhost:10000`.
