// Global leaderboard for Bintang.
// Stores only a squad name and a total score per squad, one small JSON file per squad.
import { put, list, del } from "@vercel/blob";
import { createHash, timingSafeEqual } from "node:crypto";

const PREFIX = "lb/";
const MAX_SCORE = 1000000;
const BLOCKED = ["fuck", "shit", "bitch", "cunt", "dick", "pussy", "sex", "porn", "nigg", "babi", "bodoh", "sial", "pukimak", "puki", "pantat", "lancau", "kote", "celaka", "anjing", "http", "www.", ".com"];

async function readJson(pathname) {
  const page = await list({ prefix: pathname, limit: 5 });
  const b = page.blobs.find((x) => x.pathname === pathname);
  if (!b) return null;
  try { const r = await fetch(`${b.url}?v=${Date.parse(b.uploadedAt) || Date.now()}`, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}
const writeJson = (pathname, obj) => put(pathname, JSON.stringify(obj), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
async function seasonStart() { const m = await readJson("meta/season.json"); return (m && m.start) || 0; }

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim();
const nameKey = (s) => cleanName(s).toLowerCase();
const isValidId = (s) => typeof s === "string" && /^[a-z0-9]{8,40}$/.test(s);

async function readAll() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    const rows = await Promise.all(page.blobs.map(async (b) => {
      try {
        const r = await fetch(`${b.url}?v=${Date.parse(b.uploadedAt) || Date.now()}`, { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        return { ...j, url: b.url };
      } catch { return null; }
    }));
    rows.forEach((r) => r && out.push(r));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

function adminOk(req) {
  const given = String(req.headers["x-admin-key"] || "");
  const real = String(process.env.ADMIN_KEY || "");
  if (!real || given.length !== real.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(real));
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (req.method === "GET") {
      const rows = await readAll();
      const board = rows
        .filter((r) => r && r.name)
        .map((r) => ({ id: r.id, name: r.name, score: r.score | 0, updatedAt: r.updatedAt || 0 }))
        .sort((a, b) => b.score - a.score || a.updatedAt - b.updatedAt)
        .slice(0, 100);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ squads: board, total: rows.length, seasonStart: await seasonStart() });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = body.action || "submit";

    // ---- admin ----
    if (action === "admin-clear" || action === "admin-remove") {
      if (!adminOk(req)) return res.status(401).json({ error: "Wrong admin password" });
      const page = await list({ prefix: PREFIX, limit: 1000 });
      let urls = page.blobs.map((b) => b.url);
      if (action === "admin-remove") {
        if (!isValidId(body.id)) return res.status(400).json({ error: "Missing squad id" });
        urls = page.blobs.filter((b) => b.pathname === `${PREFIX}${body.id}.json`).map((b) => b.url);
      }
      if (urls.length) await del(urls);
      if (action === "admin-clear") await writeJson("meta/season.json", { start: Date.now() });
      else await writeJson(`ban/${body.id}.json`, { at: Date.now() });
      return res.status(200).json({ ok: true, removed: urls.length });
    }
    if (action === "admin-check") {
      return adminOk(req) ? res.status(200).json({ ok: true }) : res.status(401).json({ error: "Wrong admin password" });
    }

    // ---- squads ----
    const { id, token } = body;
    if (!isValidId(id) || typeof token !== "string" || token.length < 16) return res.status(400).json({ error: "Missing squad id" });
    if (await readJson(`ban/${id}.json`)) return res.status(403).json({ error: "removed" });
    const all = await readAll();
    const mine = all.find((r) => r.id === id);
    if (mine && mine.tokenHash !== sha(token)) return res.status(403).json({ error: "This squad belongs to another device" });

    if (action === "leave") {
      if (mine) await del(mine.url);
      return res.status(200).json({ ok: true });
    }

    const name = cleanName(body.name);
    if (name.length < 2 || name.length > 24) return res.status(400).json({ error: "name_length" });
    const lower = name.toLowerCase().replace(/[^a-z0-9.]/g, "");
    if (BLOCKED.some((w) => lower.includes(w))) return res.status(400).json({ error: "name_blocked" });
    if (all.some((r) => r.id !== id && nameKey(r.name) === nameKey(name))) return res.status(409).json({ error: "name_taken" });

    const score = Math.max(0, Math.min(MAX_SCORE, Math.floor(Number(body.score) || 0)));
    const record = { id, name, score, tokenHash: mine ? mine.tokenHash : sha(token), updatedAt: Date.now() };
    await put(`${PREFIX}${id}.json`, JSON.stringify(record), {
      access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60
    });
    return res.status(200).json({ ok: true, name, score, seasonStart: await seasonStart() });
  } catch (e) {
    return res.status(500).json({ error: "Leaderboard is not available right now" });
  }
}
