#!/usr/bin/env node
// Generates assets/stats.svg for the profile README.
// Data comes straight from the GitHub API at build time, so the card never
// depends on a third-party chart service going down.
//
//   GITHUB_TOKEN=... node scripts/stats.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGIN = process.env.PROFILE_LOGIN || "shahzaibnagi";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-stats",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function rest(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function graphql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function card({ repos, contributions, stars, followers, langs, updated }) {
  const W = 660;
  const HGT = 308;
  const pad = 26;

  const stats = [
    ["repos", repos],
    ["contributions / yr", contributions],
    ["stars", stars],
    ["followers", followers],
  ];

  const statBlocks = stats
    .map(([label, value], i) => {
      const x = pad + i * ((W - pad * 2) / 4);
      return `
    <text x="${x}" y="96" class="num">${esc(value)}</text>
    <text x="${x}" y="118" class="lbl">${esc(label)}</text>`;
    })
    .join("");

  const maxPct = Math.max(...langs.map((l) => l.pct), 1);
  const bars = langs
    .map((l, i) => {
      const y = 158 + i * 22;
      const w = Math.round((l.pct / maxPct) * 300);
      return `
    <text x="${pad}" y="${y + 4}" class="lang">${esc(l.name)}</text>
    <rect x="150" y="${y - 7}" width="${w}" height="9" rx="4.5" fill="url(#g)"/>
    <text x="${150 + w + 8}" y="${y + 4}" class="pct">${l.pct.toFixed(1)}%</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HGT}" viewBox="0 0 ${W} ${HGT}" role="img" aria-label="GitHub stats for ${esc(LOGIN)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1f6feb"/>
      <stop offset="100%" stop-color="#39d353"/>
    </linearGradient>
  </defs>
  <style>
    .num  { font: 700 26px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; fill: #e6edf3; }
    .lbl  { font: 400 11px -apple-system, Segoe UI, Helvetica, Arial, sans-serif; fill: #8b949e; letter-spacing: .04em; text-transform: uppercase; }
    .lang { font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .pct  { font: 400 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .foot { font: 400 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; }
    .head { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; letter-spacing: .12em; text-transform: uppercase; }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${HGT - 1}" rx="14" fill="#0d1117" stroke="#30363d"/>
  <text x="${pad}" y="42" class="head">live github stats</text>
  <circle cx="${W - pad - 4}" cy="38" r="4" fill="#39d353">
    <animate attributeName="opacity" values="1;0.25;1" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <text x="${W - pad - 16}" y="42" class="foot" text-anchor="end">@${esc(LOGIN)}</text>
  <line x1="${pad}" y1="56" x2="${W - pad}" y2="56" stroke="#21262d"/>
  ${statBlocks}
  <line x1="${pad}" y1="134" x2="${W - pad}" y2="134" stroke="#21262d"/>
  ${bars}
  <text x="${pad}" y="${HGT - 16}" class="foot">auto-generated ${esc(updated)} · built from the GitHub API</text>
</svg>`;
}

async function main() {
  const [user, repos] = await Promise.all([
    rest(`/users/${LOGIN}`),
    rest(`/users/${LOGIN}/repos?per_page=100&sort=pushed`),
  ]);

  const owned = repos.filter((r) => !r.fork && !r.archived);
  const stars = owned.reduce((n, r) => n + r.stargazers_count, 0);

  let contributions = 0;
  try {
    const data = await graphql(`query {
      user(login: "${LOGIN}") {
        contributionsCollection { contributionCalendar { totalContributions } }
      }
    }`);
    contributions = data.user.contributionsCollection.contributionCalendar.totalContributions;
  } catch (err) {
    console.warn("contributions unavailable:", err.message);
  }

  const langBytes = {};
  for (const repo of owned.slice(0, 25)) {
    try {
      const langs = await rest(`/repos/${LOGIN}/${repo.name}/languages`);
      for (const [name, bytes] of Object.entries(langs)) {
        langBytes[name] = (langBytes[name] || 0) + bytes;
      }
    } catch (err) {
      console.warn(`languages skipped for ${repo.name}: ${err.message}`);
    }
  }

  const totalBytes = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, bytes]) => ({ name, pct: (bytes / totalBytes) * 100 }));

  const updated = new Date().toISOString().slice(0, 10);
  const svg = card({
    repos: owned.length,
    contributions,
    stars,
    followers: user.followers,
    langs,
    updated,
  });

  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "stats.svg");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, svg, "utf8");
  console.log(`wrote ${out} (${owned.length} repos, ${stars} stars, ${contributions} contributions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
