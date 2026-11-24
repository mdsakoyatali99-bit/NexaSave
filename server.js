const express = require("express");
const helmet = require("helmet");
const path = require("path");
const dns = require("dns").promises;
const http = require("http");
const https = require("https");
const ipaddr = require("ipaddr.js");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

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


const SOCIAL_HOSTS = [
  "youtube.com", "youtu.be", "facebook.com", "fb.watch", "tiktok.com"
];
const SOCIAL_TIMEOUT_MS = 4 * 60 * 1000;

function isSocialUrl(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some(domain => host === domain || host.endsWith("." + domain));
}

function getYtDlpPath() {
  const localBin = path.join(os.homedir(), ".local", "bin", "yt-dlp");
  return process.env.YTDLP_PATH || (fs.existsSync(localBin) ? localBin : "yt-dlp");
}

function runSocialDownload(rawUrl, res) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexasave-"));
    const outputTemplate = path.join(tempDir, "%(title).120B.%(ext)s");
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "--no-progress",
      "--restrict-filenames",
      "--format", "best[ext=mp4]/best[ext=webm]/best",
      "--max-filesize", "512M",
      "--output", outputTemplate,
      rawUrl
    ];
    const child = spawn(getYtDlpPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let finished = false;

    const cleanup = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!res.headersSent) {
        res.status(504).json({ error: "ভিডিও আনতে ৪ মিনিটের বেশি সময় লাগছে। পরে আবার চেষ্টা করুন।" });
      } else {
        res.destroy();
      }
      cleanup();
      finished = true;
    }, SOCIAL_TIMEOUT_MS);

    child.stderr.on("data", chunk => {
      if (stderr.length < 6000) stderr += chunk.toString();
    });

    child.on("error", error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("সোশ্যাল লিংক ডাউনলোডার সার্ভারে ইনস্টল নেই। Render-এর নতুন Build সফল হয়েছে কি না দেখুন।"));
    });

    child.on("close", code => {
      if (finished) return;
      clearTimeout(timer);
      if (code !== 0) {
        finished = true;
        cleanup();
        const detail = stderr.toLowerCase();
        if (detail.includes("private") || detail.includes("login") || detail.includes("cookies") || detail.includes("members-only")) {
          return reject(new Error("এই ভিডিওটি প্রাইভেট বা লগইন-সুরক্ষিত। NexaSave শুধু প্রকাশ্যে দেখা যায় এমন ভিডিও সমর্থন করে।"));
        }
        if (detail.includes("unsupported url")) {
          return reject(new Error("এই লিংকটি সমর্থিত নয়। Facebook, YouTube বা TikTok-এর আসল ভিডিও লিংক দিন।"));
        }
        if (detail.includes("maximum filesize") || detail.includes("file is larger")) {
          return reject(new Error("ভিডিওটি 512 MB সীমার চেয়ে বড়।"));
        }
        return reject(new Error("ভিডিওটি পাওয়া যায়নি। লিংকটি পাবলিক কি না এবং ভিডিওটি চালু আছে কি না পরীক্ষা করুন।"));
      }

      let files = [];
      try {
        files = fs.readdirSync(tempDir)
          .map(name => path.join(tempDir, name))
          .filter(file => fs.statSync(file).isFile());
      } catch {}
      if (!files.length) {
        finished = true;
        cleanup();
        return reject(new Error("ভিডিও ফাইল তৈরি হয়নি। অন্য একটি পাবলিক ভিডিও লিংক দিয়ে চেষ্টা করুন।"));
      }

      const file = files[0];
      const stat = fs.statSync(file);
      if (!stat.size || stat.size > MAX_BYTES) {
        finished = true;
        cleanup();
        return reject(new Error("ভিডিও ফাইলটি খালি অথবা 512 MB সীমার বেশি।"));
      }

      const ext = path.extname(file).toLowerCase();
      const mime = ({ ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime" })[ext] || "application/octet-stream";
      const filename = path.basename(file).replace(/["\\\r\n]/g, "_").slice(0, 150) || "nexasave-video" + (ext || ".mp4");
      res.status(200);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");

      const stream = fs.createReadStream(file);
      stream.on("error", () => {
        finished = true;
        cleanup();
        if (!res.headersSent) res.status(500).json({ error: "ডাউনলোড ফাইল পড়তে সমস্যা হয়েছে।" });
        else res.destroy();
      });
      res.on("close", () => {
        if (!res.writableEnded) {
          finished = true;
          cleanup();
          child.kill("SIGKILL");
        }
      });
      stream.on("end", () => {
        finished = true;
        cleanup();
        resolve();
      });
      stream.pipe(res);
    });
  });
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
  const raw = String(req.query.url || "").trim();
  if (!raw || raw.length > 4096) return res.status(400).json({ error: "একটি সঠিক ভিডিও লিংক পেস্ট করুন।" });

  let parsed;
  try { parsed = validateUrl(raw); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  // Public TikTok, YouTube and Facebook links are handled by yt-dlp.
  // No login cookies, DRM bypass, private content, or access-control circumvention.
  if (isSocialUrl(parsed)) {
    try {
      await runSocialDownload(parsed.toString(), res);
    } catch (error) {
      if (!res.headersSent && !res.writableEnded) {
        res.status(422).json({ error: error.message || "এই ভিডিও লিংকটি থেকে ডাউনলোড করা যায়নি।" });
      }
    }
    return;
  }

  // Other hosts must provide a direct media-file URL.
  let media;
  try {
    media = await openMedia(raw);
  } catch (error) {
    return res.status(422).json({ error: error.message || "এই লিংক থেকে সরাসরি ভিডিও ফাইল পাওয়া যায়নি।" });
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
