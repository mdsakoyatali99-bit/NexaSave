const express = require("express");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

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
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", app: "NexaSave", version: "2.0.0" });
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "1h"
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NexaSave listening on port ${PORT}`);
});
