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
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 30000;
const SOCIAL_TIMEOUT_MS = 6 * 60 * 1000;
const PYTHON = process.env.PYTHON_PATH || "/opt/venv/bin/python";

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));
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
  try { return ipaddr.process(address).range() === "unicast"; }
  catch { return false; }
}

async function resolvePublicHost(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (ipaddr.isValid(hostname)) {
    if (!publicAddress(hostname)) throw new Error("Private or reserved network addresses are not allowed.");
    return hostname;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => !publicAddress(record.address))) {
    throw new Error("The destination host did not resolve to a public address.");
  }
  return records.find(record => record.family === 4)?.address || records[0].address;
}

function validateUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("সঠিক ভিডিও লিংক দিন।"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("শুধু HTTP বা HTTPS লিংক ব্যবহার করুন।");
  if (url.username || url.password) throw new Error("লিংকের মধ্যে username/password গ্রহণযোগ্য নয়।");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("এই পোর্ট সমর্থিত নয়।");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Local network URL গ্রহণযোগ্য নয়।");
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
        "User-Agent": "Mozilla/5.0 (compatible; NexaSave/6.0; authorized media downloader)",
        "Accept": "video/*,application/octet-stream;q=0.9,*/*;q=0.1"
      },
      lookup: (_hostname, _opts, callback) => {
        const family = ipaddr.parse(pinnedAddress).kind() === "ipv4" ? 4 : 6;
        callback(null, pinnedAddress, family);
      },
      timeout: TIMEOUT_MS
    };
    const req = transport.request(options, resolve);
    req.on("timeout", () => req.destroy(new Error("Source server timeout.")));
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
    if (!location || redirects >= MAX_REDIRECTS) throw new Error("Source redirect invalid or too many redirects.");
    return openMedia(new URL(location, url).toString(), redirects + 1);
  }
  if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
    upstream.resume();
    throw new Error(`Source returned HTTP ${upstream.statusCode}.`);
  }
  const type = String(upstream.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!(type.startsWith("video/") || ["application/octet-stream", "binary/octet-stream"].includes(type))) {
    upstream.resume();
    throw new Error("এটি সরাসরি ভিডিও ফাইলের লিংক নয়। Facebook/YouTube/TikTok পোস্ট লিংক হলে সেটি সোশ্যাল লিংক হিসেবে দিন।");
  }
  const length = Number(upstream.headers["content-length"] || 0);
  if (length > MAX_BYTES) { upstream.destroy(); throw new Error("ভিডিওটি 512 MB সীমার বেশি।"); }
  return { upstream, type, length, url };
}

const SOCIAL_HOSTS = [
  "youtube.com", "youtu.be", "youtube-nocookie.com",
  "facebook.com", "fb.watch", "fb.com",
  "tiktok.com", "vm.tiktok.com"
];
function isSocialUrl(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some(domain => host === domain || host.endsWith("." + domain));
}

function htmlError(message, status = 422) {
  return `<!doctype html><html lang="bn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NexaSave — Download error</title>
  <style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#090d1b;color:#f4f5ff;font:16px system-ui}
  main{max-width:520px;padding:30px;border:1px solid #555477;border-radius:24px;background:#171b32;box-shadow:0 20px 70px #0008}
  h1{font-size:22px;margin:0 0 12px}p{color:#c5c8dd;line-height:1.7}a{color:#a9e7ff}
  </style><main><h1>ডাউনলোড করা যায়নি</h1><p>${String(message).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}</p><p>লিংকটি পাবলিক ভিডিও কি না পরীক্ষা করুন। অন্য একটি ভিডিও লিংক দিয়েও চেষ্টা করতে পারেন।</p><a href="/">NexaSave-এ ফিরে যান</a></main></html>`;
}

function sendError(req, res, message, status = 422) {
  if (res.headersSent || res.writableEnded) return;
  if ((req.headers.accept || "").includes("text/html")) {
    res.status(status).type("html").send(htmlError(message, status));
  } else {
    res.status(status).json({ error: message });
  }
}

function pythonAvailable() {
  return new Promise(resolve => {
    const child = spawn(PYTHON, ["-m", "yt_dlp", "--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let version = "";
    child.stdout.on("data", chunk => version += chunk.toString());
    child.on("error", () => resolve(null));
    child.on("close", code => resolve(code === 0 ? version.trim() : null));
  });
}

function runSocialDownload(rawUrl, req, res) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexasave-"));
    const outputTemplate = path.join(tempDir, "%(title).100B.%(id)s.%(ext)s");
    const args = [
      "-m", "yt_dlp",
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--newline",
      "--restrict-filenames",
      "--js-runtimes", "node",
      "--remote-components", "ejs:github",
      "--format", "bv*+ba/b",
      "--merge-output-format", "mp4",
      "--max-filesize", "512M",
      "--socket-timeout", "25",
      "--retries", "2",
      "--fragment-retries", "2",
      "--output", outputTemplate,
      rawUrl
    ];

    let child;
    try { child = spawn(PYTHON, args, { stdio: ["ignore", "ignore", "pipe"] }); }
    catch { return reject(new Error("ডাউনলোড ইঞ্জিন চালু করা যায়নি। Render deployment পরীক্ষা করুন।")); }

    let stderr = "";
    let settled = false;
    const cleanup = () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finishError(new Error("ভিডিও আনতে ৬ মিনিটের বেশি সময় লাগছে। পরে আবার চেষ্টা করুন।"));
    }, SOCIAL_TIMEOUT_MS);

    child.stderr.on("data", chunk => {
      if (stderr.length < 12000) stderr += chunk.toString();
    });
    child.on("error", () => finishError(new Error("সার্ভারে yt-dlp ইঞ্জিন পাওয়া যায়নি। নতুন Docker deployment সম্পন্ন হয়েছে কি না দেখুন।")));

    child.on("close", code => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.toLowerCase();
        let message = "ভিডিওটি সোর্স থেকে আনা যায়নি। ভিডিওটি পাবলিক কি না, লিংকটি সঠিক কি না এবং আপনার অঞ্চলে ভিডিওটি চালু হয় কি না পরীক্ষা করুন।";
        if (detail.includes("unsupported url")) message = "এই লিংকটি সমর্থিত নয়। Facebook, TikTok বা YouTube-এর আসল ভিডিও লিংক দিন।";
        else if (detail.includes("private") || detail.includes("login") || detail.includes("cookies") || detail.includes("members-only") || detail.includes("sign in")) message = "ভিডিওটি প্রাইভেট বা লগইন-সুরক্ষিত। শুধু প্রকাশ্যে দেখা যায় এমন ভিডিও সমর্থিত।";
        else if (detail.includes("maximum filesize") || detail.includes("file is larger")) message = "ভিডিওটি 512 MB সীমার চেয়ে বড়।";
        else if (detail.includes("javascript") || detail.includes("js runtime") || detail.includes("deno") || detail.includes("ejs")) message = "ভিডিও সাইটের JavaScript যাচাই সম্পন্ন হয়নি। Render-এর সর্বশেষ Build Log পরীক্ষা করে আবার Deploy করুন।";
        else if (detail.includes("http error 429") || detail.includes("too many requests")) message = "ভিডিও সাইট সাময়িকভাবে অনেক অনুরোধ পেয়েছে (429)। কিছুক্ষণ পর আবার চেষ্টা করুন।";
        return finishError(new Error(message));
      }

      let files = [];
      try {
        files = fs.readdirSync(tempDir).map(name => path.join(tempDir, name))
          .filter(file => fs.statSync(file).isFile() && !file.endsWith(".part") && !file.endsWith(".ytdl"));
      } catch {}
      if (!files.length) return finishError(new Error("ভিডিও ফাইল তৈরি হয়নি। অন্য একটি পাবলিক ভিডিও লিংক দিয়ে চেষ্টা করুন।"));

      const file = files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
      const stat = fs.statSync(file);
      if (!stat.size || stat.size > MAX_BYTES) return finishError(new Error("ভিডিওটি খালি অথবা 512 MB সীমার বেশি।"));

      const ext = path.extname(file).toLowerCase();
      const mime = ({ ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska", ".mov": "video/quicktime" })[ext] || "application/octet-stream";
      const filename = path.basename(file).replace(/["\\\r\n]/g, "_").slice(0, 150) || "nexasave-video.mp4";

      res.status(200);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");

      const stream = fs.createReadStream(file);
      let streamFailed = false;
      stream.on("error", () => {
        streamFailed = true;
        cleanup();
        if (!res.headersSent) sendError(req, res, "ডাউনলোড ফাইল পড়তে সমস্যা হয়েছে।", 500);
        else res.destroy();
      });
      res.on("close", () => {
        if (!res.writableEnded) {
          try { child.kill("SIGKILL"); } catch {}
          cleanup();
        }
      });
      stream.on("end", () => {
        if (!streamFailed) {
          settled = true;
          cleanup();
          resolve();
        }
      });
      stream.pipe(res);
    });
  });
}

function safeFilename(url, contentType) {
  let name = decodeURIComponent(url.pathname.split("/").pop() || "nexasave-video")
    .replace(/[\x00-\x1f\x7f"<>:|?*\/\\]/g, "_").slice(0, 120);
  if (!name || name === "_") name = "nexasave-video";
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    name += ({ "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv" })[contentType] || ".video";
  }
  return name;
}

// Explicit homepage route: avoids a plain "Not Found" response if static index
// resolution differs between Render runtime configurations.
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"), error => {
    if (error && !res.headersSent) {
      console.error("Homepage file missing:", error.message);
      res.status(500).type("text").send("NexaSave homepage is missing from the deployment. Check that public/index.html is committed to GitHub.");
    }
  });
});

app.get("/health", async (_req, res) => {
  const ytDlp = await pythonAvailable();
  res.json({
    status: "ok",
    app: "NexaSave",
    version: "6.0.0",
    socialDownloader: ytDlp ? "ready" : "missing",
    ytDlpVersion: ytDlp,
    nodeVersion: process.version,
    homepage: fs.existsSync(path.join(__dirname, "public", "index.html")) ? "found" : "missing",
    staticDirectory: fs.existsSync(path.join(__dirname, "public")) ? "found" : "missing"
  });
});

app.get("/api/download", async (req, res) => {
  const raw = String(req.query.url || "").trim();
  if (!raw || raw.length > 4096) return sendError(req, res, "একটি সঠিক ভিডিও লিংক পেস্ট করুন।", 400);

  let parsed;
  try { parsed = validateUrl(raw); }
  catch (error) { return sendError(req, res, error.message, 400); }

  if (isSocialUrl(parsed)) {
    const installed = await pythonAvailable();
    if (!installed) return sendError(req, res, "সার্ভারের ভিডিও ডাউনলোড ইঞ্জিন ইনস্টল হয়নি। Render-এ নতুন Deploy করুন; /health-এ socialDownloader ready দেখাতে হবে।", 503);
    try { await runSocialDownload(parsed.toString(), req, res); }
    catch (error) { sendError(req, res, error.message || "ভিডিও ডাউনলোড করা যায়নি।", 422); }
    return;
  }

  let media;
  try { media = await openMedia(raw); }
  catch (error) { return sendError(req, res, error.message || "সরাসরি ভিডিও ফাইল পাওয়া যায়নি।", 422); }

  const filename = safeFilename(media.url, media.type).replace(/["\\]/g, "_");
  res.status(200);
  res.setHeader("Content-Type", media.type);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (media.length) res.setHeader("Content-Length", String(media.length));

  let sent = 0;
  media.upstream.on("data", chunk => {
    sent += chunk.length;
    if (sent > MAX_BYTES) { media.upstream.destroy(new Error("File exceeded limit.")); res.destroy(); }
  });
  media.upstream.on("error", () => { if (!res.headersSent) sendError(req, res, "সোর্স থেকে ডাউনলোড বিচ্ছিন্ন হয়েছে।", 502); else res.destroy(); });
  media.upstream.pipe(res);
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "API endpoint not found.",
    requestedPath: _req.path,
    hint: "Use GET /api/download?url=VIDEO_URL or GET /health."
  });
});

app.use((_req, res) => {
  res.status(404).type("text").send("NexaSave: page not found. Open the website homepage or check the requested URL.");
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error. Check Render logs." });
  else res.destroy();
});

app.listen(PORT, "0.0.0.0", () => console.log(`NexaSave v6.1 listening on ${PORT}`));
