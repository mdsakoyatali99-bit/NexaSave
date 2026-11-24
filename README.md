# NexaSave v6 — Deployment repair

## Why this version changes the deployment
The previous version relied on a Python package installed into a Node runtime's user directory. That can leave the command unavailable at runtime, and modern YouTube extraction also needs a supported JavaScript runtime and the yt-dlp EJS challenge scripts. This version uses Docker so the runtime is deterministic.

## Included
- Node.js 22
- Python virtual environment at `/opt/venv`
- Latest `yt-dlp[default]` installed into that virtual environment
- Node 22 explicitly enabled as yt-dlp's JavaScript runtime
- `yt-dlp-ejs` support through the default extra
- FFmpeg for merging separate audio/video streams
- Direct browser attachment download (does not load the entire 512 MB file into browser JavaScript memory)
- Public Facebook, TikTok and YouTube links where the current public extractor supports them
- Direct MP4/WebM/MOV URLs
- `/health` reports the installed yt-dlp version and whether the downloader is ready

## Update on Render
1. Extract this ZIP.
2. Upload/replace all project files in the **root** of the GitHub repository. Make sure `Dockerfile` and `render.yaml` are at the repository root.
3. In Render, open the existing NexaSave service → Settings. The service must use the **Docker** runtime. If the current service was created as a Node native service, create a new Web Service from this repository and select Docker (a native Node service cannot switch runtime in-place).
4. Set the Dockerfile path to `./Dockerfile` if asked.
5. Deploy and wait for the Docker build to finish.
6. Open `https://YOUR-SERVICE.onrender.com/health`. Expected JSON includes:
   - `"version":"6.0.0"`
   - `"socialDownloader":"ready"`
   - a non-empty `"ytDlpVersion"`
   - `"nodeVersion":"v22..."`

If `/health` says `socialDownloader: "missing"`, the Docker build did not deploy correctly. Do not test video links until it says `ready`.

## Notes and limitations
- Supports public video links only, where platform extraction is currently permitted and available.
- Facebook share URLs may resolve differently by region or post privacy. TikTok short links may redirect to the canonical post. Platform anti-bot/rate limits, geo restrictions and extractor changes can still block individual posts.
- Does not use account cookies, credentials, DRM bypass, or private-content access.
- Videos requiring login, age verification, membership or other access controls are not supported.
- Maximum output size is 512 MB; social extraction timeout is 6 minutes. Render free-tier resource and request limits may interrupt large/long downloads.
- Download only content you own or have permission to save and follow platform terms and applicable law.

## Local run
Docker is recommended:
```bash
docker build -t nexasave .
docker run -p 10000:10000 nexasave
```
Then open `http://localhost:10000`.
