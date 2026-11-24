const express = require("express");
const helmet = require("helmet");
const path = require("path");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const ipaddr = require("ipaddr.js");

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 30000;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      connectSrc: ["'self'", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"],
      upgradeInsecureRequests: null
    }
  }
}));

function publicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

async function resolvePublicHost(hostname) {
  // IP literals and DNS names are both checked. Only globally routable addresses pass.
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (ipaddr.isValid(hostname)) {
    if (!publicAddress(hostname)) throw new Error("Private or reserved network addresses are not allowed.");
    return hostname;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => !publicAddress(record.address))) {
    throw new Error("The destination host did not resolve to a public address.");
  }
  // Pin the request to a checked address to reduce DNS-rebinding/SSRF risk.
  return records.find(record => record.family === 4)?.address || records[0].address;
}

function validateUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid video URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS video links are supported.");
  if (url.username || url.password) throw new Error("URLs containing embedded usernames or passwords are not supported.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("This destination port is not supported.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Local network addresses are not allowed.");
  return url;
}

function requestPinned(url, pinnedAddress) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const options = {
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "User-Agent": "NexaSave/4.0 (+authorized direct media downloader)",
        "Accept": "video/*,application/octet-stream;q=0.9,*/*;q=0.1"
      },
      lookup: (_hostname, _opts, callback) => {
        const family = ipaddr.parse(pinnedAddress).kind() === "ipv4" ? 4 : 6;
        callback(null, pinnedAddress, family);
      },
      timeout: TIMEOUT_MS
    };
    const req = transport.request(options, resolve);
    req.on("timeout", () => req.destroy(new Error("The source server took too long to respond.")));
    req.on("error", reject);
    req.end();
  });
}

async function openMedia(raw, redirects = 0) {
  const url = validateUrl(raw);
  const pinned = await resolvePublicHost(url.hostname);
  const upstream = await requestPinned(url, pinned);
  if ([301, 302, 303, 307, 308].includes(upstream.statusCode)) {
    const location = upstream.headers.location;
    upstream.resume();
    if (!location || redirects >= MAX_REDIRECTS) throw new Error("Too many or invalid redirects from the source.");
    const next = new URL(location, url).toString();
    return openMedia(next, redirects + 1);
  }
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    upstream.resume();
    throw new Error(`The source server returned HTTP ${upstream.statusCode}.`);
  }
  const type = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!(type.startsWith("video/") || type === "application/octet-stream" || type === "binary/octet-stream")) {
    upstream.resume();
    throw new Error("That link does not return a video file. Paste a direct media-file URL, not a social-media post or share page.");
  }
  const length = Number(upstream.headers["content-length"] || 0);
  if (length > MAX_BYTES) {
    upstream.destroy();
    throw new Error("This file is larger than the 512 MB limit.");
  }
  return { upstream, type, length, url };
}

function safeFilename(url, contentType) {
  let name = decodeURIComponent(url.pathname.split("/").pop() || "nexasave-video").replace(/[\\x00-\\x1f\\x7f"<>:|?*\\/\\\\]/g, "_").slice(0, 120);
  if (!name || name === "_") name = "nexasave-video";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    const ext = ({ "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv", "video/ogg": ".ogv" })[contentType] || ".video";
    name += ext;
  }
  return name;
}

app.get("/health", (_req, res) => res.json({ status: "ok", app: "NexaSave", version: "4.0.0" }));

app.get("/api/download", async (req, res) => {
  const raw = String(req.query.url || "");
  if (!raw || raw.length > 4096) return res.status(400).json({ error: "Paste a valid direct video URL." });
  let media;
  try {
    media = await openMedia(raw);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to retrieve this video file." });
  }

  const filename = safeFilename(media.url, media.type);
  res.status(200);
  res.setHeader("Content-Type", media.type);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/["\\]/g, "_")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  if (media.length) res.setHeader("Content-Length", String(media.length));

  let sent = 0;
  media.upstream.on("data", chunk => {
    sent += chunk.length;
    if (sent > MAX_BYTES) {
      media.upstream.destroy(new Error("File exceeded the 512 MB download limit."));
      res.destroy();
    }
  });
  media.upstream.on("error", () => {
    if (!res.headersSent) res.status(502).json({ error: "The source interrupted the download." });
    else res.destroy();
  });
  media.upstream.pipe(res);
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: "1h" }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`NexaSave listening on ${PORT}`));
