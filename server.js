"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { runPipeline } = require("./lib/pipeline");
const { validateGuide, slugify } = require("./lib/schema");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const LIB_DIR = path.join(ROOT, "data", "guides");
const GEN_DIR = path.join(ROOT, "data", "generated");
const PUBLIC = path.join(ROOT, "public");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}
function summary(g) {
  return { slug: g.slug, app: g.app, category: g.category, origin: g.origin, verdict: g.verdict, difficulty: g.difficulty, time: g.time, lastVerified: g.lastVerified };
}
function findGuide(slug) {
  for (const dir of [LIB_DIR, GEN_DIR]) {
    const f = path.join(dir, slug + ".json");
    if (/^[a-z0-9-]+$/.test(slug) && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  }
  return null;
}
function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Small abuse guard: live generation costs real API money.
const hits = new Map();
let running = 0;
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= (Number(process.env.GEN_PER_HOUR) || 5)) return false;
  list.push(now);
  hits.set(ip, list);
  return true;
}

let claude = null;
function getClaude() {
  if (!claude) claude = require("./lib/anthropic").makeClaude();
  return claude;
}

async function generate(req, res, query) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    send("fail", { message: "Live generation needs ANTHROPIC_API_KEY set on the server. The library guides still work." });
    return res.end();
  }
  const hit = findGuide(slugify(query));
  if (hit) { send("done", { slug: hit.slug, cached: true }); return res.end(); }

  const ip = req.socket.remoteAddress;
  if (!allowed(ip)) { send("fail", { message: "Generation limit reached for this hour. Try again later." }); return res.end(); }
  if (running >= 3) { send("fail", { message: "Server is busy generating other guides. Try again in a minute." }); return res.end(); }

  running++;
  try {
    const guide = await runPipeline({ query, claude: getClaude(), emit: (e) => send("progress", e) });
    const errs = validateGuide(guide);
    if (errs.length) throw new Error("Guide failed validation: " + errs[0]);
    if (findGuide(guide.slug)) guide.slug = guide.slug + "-" + Date.now().toString(36);
    fs.mkdirSync(GEN_DIR, { recursive: true });
    fs.writeFileSync(path.join(GEN_DIR, guide.slug + ".json"), JSON.stringify(guide, null, 2));
    send("done", { slug: guide.slug });
  } catch (e) {
    send("fail", { message: e.message, code: e.code || "ERROR" });
  } finally {
    running--;
    res.end();
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/api/guides") return json(res, 200, [...readDir(LIB_DIR), ...readDir(GEN_DIR)].map(summary));
  if (p.startsWith("/api/guide/")) {
    const g = findGuide(p.slice("/api/guide/".length));
    return g ? json(res, 200, g) : json(res, 404, { error: "not found" });
  }
  if (p === "/api/generate") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    if (q.length < 2) return json(res, 400, { error: "query too short" });
    return generate(req, res, q);
  }
  if (p === "/api/health") return json(res, 200, { ok: true, liveGeneration: !!process.env.ANTHROPIC_API_KEY });

  // Pretty share URL: /g/<slug> serves the same single-page app
  let file = p.startsWith("/g/") || p === "/" ? "index.html" : p.slice(1);
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`OAuth guides on http://localhost:${PORT}  (live generation: ${process.env.ANTHROPIC_API_KEY ? "on" : "off, set ANTHROPIC_API_KEY"})`));
}
module.exports = server;
