# NexaSave v6.1 — Render routing and download diagnostics

## What this patch fixes
- Adds an explicit `/` homepage route and serves `public/index.html` directly.
- Serves static assets before API routing.
- Adds clear JSON 404 diagnostics for unknown `/api/*` endpoints.
- Adds `/health` diagnostics for homepage/static files and yt-dlp installation.
- Uses an absolute same-origin download endpoint URL in the frontend.
- Keeps the Docker-based Python + yt-dlp + Node 22 + FFmpeg downloader setup.

## Required Render deployment setup
This project uses a Dockerfile. If your existing Render service was created as a Node Native service or Static Site, create a **new Web Service** using the same GitHub repository and choose **Docker** as the runtime. Do not deploy this Docker project as a Static Site or Native Node service.

1. Extract ZIP and upload all contents to the GitHub repository root.
2. Confirm `Dockerfile`, `render.yaml`, `server.js`, `package.json`, and the `public/` folder are at repository root.
3. Render → New + → Web Service → connect repository → Runtime: Docker.
4. Dockerfile path: `./Dockerfile`.
5. Deploy and wait until Render says Live.
6. Open the service root URL. It should show the NexaSave homepage.
7. Open `/health`. It should return JSON with `version: 6.0.0`, `socialDownloader: ready`, `homepage: found`, and `staticDirectory: found`.

If `/health` works but the homepage is Not Found, check that the correct service URL is being opened and that `public/index.html` was committed. If the old Render service remains active, it may still point at the old build or wrong runtime.

## Limits
Public Facebook, TikTok and YouTube URLs are attempted through yt-dlp where their current public extractors permit access. Private/login-only/DRM-protected videos are not supported. Platform restrictions, rate limits, region blocking and extractor changes can still prevent an individual download. Direct media-file URLs are also supported. Maximum file size is 512 MB and social extraction timeout is 6 minutes.
