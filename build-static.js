"use strict";
// Builds dist/oauth-guides-demo.html: one offline file with every guide embedded.
// Shareable by email or any static host. Live generation stays server-only.
const fs = require("fs");
const path = require("path");

const dirs = ["data/guides", "data/generated"].map((d) => path.join(__dirname, d));
const guides = dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))) : []));
const html = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
const data = JSON.stringify(guides).replace(/</g, "\\u003c");
const out = html.replace("<script>\nconst $ =", `<script>window.__GUIDES__=${data};</script>\n<script>\nconst $ =`);
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist/oauth-guides-demo.html"), out);
console.log(`built dist/oauth-guides-demo.html with ${guides.length} guides`);
