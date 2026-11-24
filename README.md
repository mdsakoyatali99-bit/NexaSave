# NexaSave — Render-ready video saver

NexaSave is a responsive, glassmorphism-styled web app with:
- Direct video-file URL handoff (MP4, WebM, MOV, M4V, OGV).
- Local video file selection and browser download.
- Live weather card based on browser geolocation, with city search fallback.
- Automatic weather/time-responsive background themes (sunny, cloudy, rain, thunder, snow, fog, night).
- Express backend, security headers, and `/health` endpoint.
- Render Blueprint configuration (`render.yaml`).

## Deploy from GitHub to Render

1. Create a new GitHub repository.
2. Upload the contents of this folder to the repository root (not the ZIP itself).
3. In Render, choose **New + → Blueprint** and connect the repository.
4. Render detects `render.yaml`. Confirm creation.
5. Wait for deployment, then open the generated `onrender.com` URL.

You can also create a **Web Service** manually:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`

No Python backend is required. Render provides the `PORT` environment variable and the Node server listens on it.

## Important platform and safety limits

This starter intentionally does not scrape TikTok, YouTube, or Facebook share pages, bypass DRM, evade access controls, or proxy arbitrary URLs through the server. A platform share URL is not the same as a direct video-file URL. Platform-specific features must use official/authorized integrations and respect each platform's terms, user permissions, and copyright law.

Direct URL mode uses the visitor's browser. Some hosts block cross-origin downloads or require authentication; in those cases use the host's official download feature. Local files are processed in the browser and are not uploaded to this server.

## Local development

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open `http://localhost:10000`.


## Weather feature
The page asks the visitor for browser location permission. If allowed, coordinates are used directly in the browser to fetch current weather from Open-Meteo; the app server does not receive or store the coordinates. If permission is denied, visitors can use **Change location** to search for a city. The selected location is stored in that browser's local storage so it can refresh later. Weather conditions and day/night state change the page's background theme. Weather API availability and forecast precision depend on Open-Meteo's data coverage.

Open-Meteo API documentation: https://open-meteo.com/en/docs
