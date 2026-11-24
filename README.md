# NexaSave v5 — Social video links + direct media downloader

## What's new in v5
- Accepts public Facebook, YouTube and TikTok video links using `yt-dlp`.
- Still supports direct MP4/WebM/MOV and other direct media-file URLs.
- Downloads one video at a time, with a 512 MB maximum and a 4-minute extraction timeout.
- Clear Bengali errors for private, unavailable, unsupported or too-large videos.
- Keeps the glassmorphism UI, weather themes and local file-saving feature.

## Deploy on GitHub → Render
1. Extract this ZIP and upload the **contents** to the root of your GitHub repository.
2. In Render choose **New + → Blueprint**, connect the repository and deploy `render.yaml`.
3. Render build installs `yt-dlp` from `requirements.txt`, then runs `npm install`.
4. After deployment, open the service URL and test `/health` (should return JSON with status `ok`).

If you already have an existing Render service, push/replace these files in the connected GitHub repository and trigger **Manual Deploy → Clear build cache & deploy**. A fresh build is important so yt-dlp is installed.

## Supported and important limitations
- Publicly accessible Facebook, YouTube and TikTok video URLs are supported where the upstream platform/extractor currently permits access.
- Direct media-file URLs from other hosts are supported too.
- Private, age/login-restricted, members-only, DRM-protected or otherwise access-controlled videos are not supported. No login cookies, account credentials, DRM bypass or access-control circumvention are used.
- Platform changes, regional restrictions, rate limits and anti-bot responses can still make a particular public URL unavailable. This cannot be guaranteed for every post/share link.
- Download only videos you own or have permission to save, and follow the source platform's terms and applicable law.
- Maximum output size: 512 MB. Maximum social extraction time: 4 minutes. Render instance memory/disk and plan limits also apply.

## Local run
Install Python 3 and Node.js 18+, then:
```bash
python3 -m pip install --user -r requirements.txt
npm install
npm start
```
Open `http://localhost:10000`.

## Weather privacy
Weather uses Open-Meteo from the visitor's browser. Location permission is requested by the browser; coordinates are not sent to the NexaSave backend.
